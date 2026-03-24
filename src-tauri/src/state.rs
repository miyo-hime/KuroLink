use std::collections::HashMap;
use tokio::sync::{mpsc, Mutex};

use crate::config::AppConfig;
use crate::ssh::{ChannelInput, SshSession};

pub enum ChannelKind {
    Shell {
        input_tx: mpsc::Sender<ChannelInput>,
    },
    // Phase 2: Vnc { ... }
}

pub struct ActiveChannel {
    pub channel_id: String,
    pub kind: ChannelKind,
}

pub struct ActiveSession {
    pub session_id: String,
    pub profile_id: String,
    pub ssh: SshSession,
    pub channels: HashMap<String, ActiveChannel>,
}

pub struct AppState {
    pub sessions: Mutex<HashMap<String, ActiveSession>>,
    pub config: Mutex<Option<AppConfig>>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
            config: Mutex::new(None),
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
