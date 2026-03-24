use std::collections::HashMap;
use tokio::sync::{mpsc, Mutex};

use crate::ssh::{ChannelInput, SshSession};

pub struct ActiveChannel {
    pub channel_id: String,
    pub input_tx: mpsc::Sender<ChannelInput>,
}

pub struct ActiveSession {
    pub session_id: String,
    pub profile_id: String,
    pub ssh: SshSession,
    pub channels: HashMap<String, ActiveChannel>,
}

pub struct AppState {
    pub sessions: Mutex<HashMap<String, ActiveSession>>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
        }
    }
}
