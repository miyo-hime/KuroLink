use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use sysinfo::{Disks, System};
use tokio::sync::{mpsc, oneshot, Mutex};

use crate::config::AppConfig;
use crate::ssh::{ChannelInput, SshSession};

// channels are the universal unit - ssh and local shells use the same interface
pub enum ChannelBackend {
    Ssh {
        session_id: String,
        input_tx: mpsc::Sender<ChannelInput>,
    },
    Local {
        input_tx: mpsc::Sender<ChannelInput>,
    },
}

pub struct ActiveChannel {
    pub backend: ChannelBackend,
    // local shells wait for the frontend to signal "listener ready" before
    // the reader thread starts pushing output. None for ssh channels
    pub start_signal: Option<oneshot::Sender<()>>,
}

impl ActiveChannel {
    /// get the input sender regardless of backend type
    pub fn input_tx(&self) -> &mpsc::Sender<ChannelInput> {
        match &self.backend {
            ChannelBackend::Ssh { input_tx, .. } => input_tx,
            ChannelBackend::Local { input_tx } => input_tx,
        }
    }

    /// get the session_id if this is an ssh channel
    pub fn session_id(&self) -> Option<&str> {
        match &self.backend {
            ChannelBackend::Ssh { session_id, .. } => Some(session_id),
            ChannelBackend::Local { .. } => None,
        }
    }
}

// ssh sessions live separately, tracked by channel count
pub struct SshSessionEntry {
    pub session_id: String,
    pub profile_id: String,
    pub ssh: SshSession,
    pub channel_count: usize,
    // one sftp channel per session, opened lazily on the first file op and shared
    // by Arc so transfers don't hold the sessions lock. drops with the entry.
    pub sftp: Option<Arc<russh_sftp::client::SftpSession>>,
}

pub struct AppState {
    pub ssh_sessions: Mutex<HashMap<String, SshSessionEntry>>,
    pub channels: Mutex<HashMap<String, ActiveChannel>>,
    pub config: Mutex<Option<AppConfig>>,
    pub launch_path: Mutex<Option<String>>,
    pub local_system: Mutex<System>,
    pub local_disks: Mutex<Disks>,
    // live transfers, keyed by id -> "please stop" flag the streaming loop polls
    pub transfers: Mutex<HashMap<String, Arc<AtomicBool>>>,
}

impl AppState {
    pub fn new() -> Self {
        // check for --path arg
        let launch_path = std::env::args().skip_while(|a| a != "--path").nth(1);

        Self {
            ssh_sessions: Mutex::new(HashMap::new()),
            channels: Mutex::new(HashMap::new()),
            config: Mutex::new(None),
            launch_path: Mutex::new(launch_path),
            local_system: Mutex::new(System::new()),
            local_disks: Mutex::new(Disks::new_with_refreshed_list()),
            transfers: Mutex::new(HashMap::new()),
        }
    }

    /// hand the caller a fresh cancel flag and stash a clone so cancel_transfer
    /// can flip it from another command while the stream runs lock-free
    pub async fn register_transfer(&self, id: &str) -> Arc<AtomicBool> {
        let flag = Arc::new(AtomicBool::new(false));
        self.transfers
            .lock()
            .await
            .insert(id.to_string(), flag.clone());
        flag
    }

    pub async fn cancel_transfer(&self, id: &str) {
        if let Some(flag) = self.transfers.lock().await.get(id) {
            flag.store(true, Ordering::Relaxed);
        }
    }

    pub async fn finish_transfer(&self, id: &str) {
        self.transfers.lock().await.remove(id);
    }

    pub async fn get_config(&self, app: &tauri::AppHandle) -> Result<AppConfig, String> {
        let mut guard = self.config.lock().await;
        if let Some(ref cfg) = *guard {
            return Ok(cfg.clone());
        }
        let cfg = crate::config::load_config(app)?;
        *guard = Some(cfg.clone());
        Ok(cfg)
    }

    pub async fn update_config(
        &self,
        app: &tauri::AppHandle,
        config: AppConfig,
    ) -> Result<(), String> {
        crate::config::save_config(app, &config)?;
        *self.config.lock().await = Some(config);
        Ok(())
    }
}
