use std::collections::HashMap;
use tokio::sync::{mpsc, Mutex};

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
    pub channel_id: String,
    pub backend: ChannelBackend,
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
}

pub struct AppState {
    pub ssh_sessions: Mutex<HashMap<String, SshSessionEntry>>,
    pub channels: Mutex<HashMap<String, ActiveChannel>>,
    pub config: Mutex<Option<AppConfig>>,
    pub launch_path: Mutex<Option<String>>,
}

impl AppState {
    pub fn new() -> Self {
        // check for --path arg
        let launch_path = std::env::args()
            .skip_while(|a| a != "--path")
            .nth(1);

        Self {
            ssh_sessions: Mutex::new(HashMap::new()),
            channels: Mutex::new(HashMap::new()),
            config: Mutex::new(None),
            launch_path: Mutex::new(launch_path),
        }
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

    pub async fn update_config(&self, app: &tauri::AppHandle, config: AppConfig) -> Result<(), String> {
        crate::config::save_config(app, &config)?;
        *self.config.lock().await = Some(config);
        Ok(())
    }
}
