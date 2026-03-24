use russh::client;
use russh::keys::{load_secret_key, PrivateKeyWithHashAlg};
use russh::{Channel, ChannelMsg, Disconnect};
use russh::keys::ssh_key::PublicKey;
use std::sync::Arc;
use std::time::Instant;
use tauri::{AppHandle, Emitter};
use tokio::sync::mpsc;

// -- Handler --

pub struct SshHandler;

impl client::Handler for SshHandler {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        _server_public_key: &PublicKey,
    ) -> Result<bool, Self::Error> {
        // MVP: accept all server keys
        // TODO Phase 2: known_hosts verification
        Ok(true)
    }
}

// -- Session --

pub struct SshSession {
    handle: client::Handle<SshHandler>,
}

impl SshSession {
    pub async fn connect(
        host: &str,
        port: u16,
        username: &str,
        key_path: &str,
    ) -> Result<Self, String> {
        // Expand ~ to home dir
        let expanded_path = if key_path.starts_with("~/") {
            let home = std::env::var("USERPROFILE")
                .or_else(|_| std::env::var("HOME"))
                .map_err(|_| "Could not determine home directory".to_string())?;
            key_path.replacen("~", &home, 1)
        } else {
            key_path.to_string()
        };

        let key = load_secret_key(&expanded_path, None)
            .map_err(|e| format!("Failed to load SSH key '{}': {e}", expanded_path))?;

        let config = Arc::new(client::Config {
            inactivity_timeout: Some(std::time::Duration::from_secs(30)),
            keepalive_interval: Some(std::time::Duration::from_secs(15)),
            keepalive_max: 3,
            ..Default::default()
        });

        let handler = SshHandler;
        let mut handle = client::connect(config, (host, port), handler)
            .await
            .map_err(|e| format!("SSH connection failed: {e}"))?;

        let best_hash = handle
            .best_supported_rsa_hash()
            .await
            .map_err(|e| format!("Failed to negotiate hash: {e}"))?
            .flatten();

        let key_with_hash = PrivateKeyWithHashAlg::new(Arc::new(key), best_hash);

        let auth_result = handle
            .authenticate_publickey(username, key_with_hash)
            .await
            .map_err(|e| format!("SSH authentication failed: {e}"))?;

        if !auth_result.success() {
            return Err("SSH authentication rejected by server".to_string());
        }

        Ok(Self { handle })
    }

    pub async fn open_shell(
        &mut self,
        cols: u32,
        rows: u32,
    ) -> Result<Channel<client::Msg>, String> {
        let channel = self
            .handle
            .channel_open_session()
            .await
            .map_err(|e| format!("Failed to open channel: {e}"))?;

        channel
            .request_pty(
                true,
                "xterm-256color",
                cols,
                rows,
                0,
                0,
                &[],
            )
            .await
            .map_err(|e| format!("Failed to request PTY: {e}"))?;

        channel
            .request_shell(true)
            .await
            .map_err(|e| format!("Failed to request shell: {e}"))?;

        Ok(channel)
    }

    pub async fn exec_command(&mut self, command: &str) -> Result<String, String> {
        let mut channel = self
            .handle
            .channel_open_session()
            .await
            .map_err(|e| format!("Failed to open exec channel: {e}"))?;

        channel
            .exec(true, command)
            .await
            .map_err(|e| format!("Failed to exec command: {e}"))?;

        let mut output = Vec::new();
        loop {
            match channel.wait().await {
                Some(ChannelMsg::Data { data }) => {
                    output.extend_from_slice(&data);
                }
                Some(ChannelMsg::ExtendedData { data, .. }) => {
                    output.extend_from_slice(&data);
                }
                Some(ChannelMsg::ExitStatus { .. }) | Some(ChannelMsg::Eof) => {}
                Some(ChannelMsg::Close) | None => break,
                _ => {}
            }
        }

        Ok(String::from_utf8_lossy(&output).to_string())
    }

    pub async fn ping(&mut self) -> Result<u64, String> {
        let start = Instant::now();
        self.exec_command("echo pong").await?;
        Ok(start.elapsed().as_millis() as u64)
    }

    pub async fn disconnect(&mut self) -> Result<(), String> {
        self.handle
            .disconnect(Disconnect::ByApplication, "User disconnected", "en")
            .await
            .map_err(|e| format!("Disconnect failed: {e}"))
    }
}

// -- Channel IO bridge --

pub enum ChannelInput {
    Data(Vec<u8>),
    Resize { cols: u32, rows: u32 },
    Close,
}

/// Spawns a tokio task that bridges a russh channel to Tauri events.
/// Returns an mpsc::Sender for sending input/resize/close to the channel.
pub fn spawn_channel_io(
    app: AppHandle,
    channel_id: String,
    mut channel: Channel<client::Msg>,
) -> mpsc::Sender<ChannelInput> {
    let (tx, mut rx) = mpsc::channel::<ChannelInput>(256);

    tokio::spawn(async move {
        loop {
            tokio::select! {
                // Data from the remote (SSH -> frontend)
                msg = channel.wait() => {
                    match msg {
                        Some(ChannelMsg::Data { data }) => {
                            let text = String::from_utf8_lossy(&data).to_string();
                            let event = format!("terminal-output-{channel_id}");
                            let _ = app.emit(&event, text);
                        }
                        Some(ChannelMsg::ExtendedData { data, .. }) => {
                            let text = String::from_utf8_lossy(&data).to_string();
                            let event = format!("terminal-output-{channel_id}");
                            let _ = app.emit(&event, text);
                        }
                        Some(ChannelMsg::ExitStatus { .. }) | Some(ChannelMsg::Eof) => {
                            // Keep looping until Close/None
                        }
                        Some(ChannelMsg::Close) | None => {
                            let event = format!("terminal-closed-{channel_id}");
                            let _ = app.emit(&event, ());
                            break;
                        }
                        _ => {}
                    }
                }
                // Input from the frontend (frontend -> SSH)
                input = rx.recv() => {
                    match input {
                        Some(ChannelInput::Data(bytes)) => {
                            if let Err(e) = channel.data(&bytes[..]).await {
                                log::error!("Failed to write to channel: {e}");
                                break;
                            }
                        }
                        Some(ChannelInput::Resize { cols, rows }) => {
                            let _ = channel.window_change(cols, rows, 0, 0).await;
                        }
                        Some(ChannelInput::Close) | None => {
                            let _ = channel.close().await;
                            break;
                        }
                    }
                }
            }
        }
    });

    tx
}
