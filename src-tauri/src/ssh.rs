use russh::client;
use russh::keys::agent::client::{AgentClient, AgentStream};
use russh::keys::{load_secret_key, PrivateKeyWithHashAlg};
use russh::{Channel, ChannelMsg, Disconnect};
use russh::keys::ssh_key::PublicKey;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Instant;
use tauri::{AppHandle, Emitter};
use tokio::sync::mpsc;

// handler

pub struct SshHandler {
    known_hosts_path: PathBuf,
    host: String,
}

impl SshHandler {
    /// check server key against known_hosts. TOFU - trust on first use,
    /// reject if the key changed (possible MITM)
    fn verify_known_host(&self, server_key: &PublicKey) -> Result<bool, String> {
        let key_str = server_key.to_string();
        let host = &self.host;

        let contents = match std::fs::read_to_string(&self.known_hosts_path) {
            Ok(c) => c,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => String::new(),
            Err(e) => return Err(format!("Failed to read known_hosts: {e}")),
        };

        for line in contents.lines() {
            let line = line.trim();
            if line.is_empty() || line.starts_with('#') {
                continue;
            }
            // format: hostname algorithm base64key [comment]
            let Some((entry_host, remaining)) = line.split_once(' ') else { continue };

            if entry_host == host {
                // found it, check if key matches
                if remaining.trim() == key_str.trim() {
                    return Ok(true);
                } else {
                    log::warn!(
                        "HOST KEY MISMATCH for {host}! Stored key differs from server key. \
                         Possible MITM attack."
                    );
                    return Ok(false);
                }
            }
        }

        // new host, trust and save (TOFU)
        log::info!("New host {host}, adding to known_hosts (TOFU)");
        if let Some(parent) = self.known_hosts_path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let entry = format!("{host} {key_str}\n");
        if let Err(e) = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.known_hosts_path)
            .and_then(|mut f| std::io::Write::write_all(&mut f, entry.as_bytes()))
        {
            log::error!("Failed to write known_hosts: {e}");
            // don't fail the connection over this
        }

        Ok(true)
    }
}

impl client::Handler for SshHandler {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        server_public_key: &PublicKey,
    ) -> Result<bool, Self::Error> {
        match self.verify_known_host(server_public_key) {
            Ok(trusted) => Ok(trusted),
            Err(e) => {
                log::error!("known_hosts verification error: {e}");
                // Fail open on read errors so we don't lock users out
                Ok(true)
            }
        }
    }
}

// agent

type DynAgent = AgentClient<Box<dyn AgentStream + Send + Unpin + 'static>>;

/// connect to whatever SSH agent is available on this platform.
/// windows: openssh named pipe first, then pageant.
/// linux/mac: SSH_AUTH_SOCK.
pub async fn connect_agent() -> Result<DynAgent, String> {
    #[cfg(windows)]
    {
        // try openssh agent first (modern windows default)
        if let Ok(agent) = AgentClient::connect_named_pipe(r"\\.\pipe\openssh-ssh-agent").await {
            return Ok(agent.dynamic());
        }
        // fall back to pageant
        if let Ok(agent) = AgentClient::connect_pageant().await {
            return Ok(agent.dynamic());
        }
        Err("no SSH agent found - start OpenSSH Authentication Agent service or Pageant".into())
    }
    #[cfg(not(windows))]
    {
        AgentClient::connect_env()
            .await
            .map(|a| a.dynamic())
            .map_err(|e| format!("SSH agent not available: {e} - is ssh-agent running?"))
    }
}

#[derive(Serialize, Deserialize, Clone)]
pub struct AgentIdentityInfo {
    pub key_type: String,
    pub fingerprint: String,
    pub comment: String,
}

/// list keys from the running SSH agent
pub async fn list_agent_keys() -> Result<Vec<AgentIdentityInfo>, String> {
    let mut agent = connect_agent().await?;
    let keys = agent.request_identities().await
        .map_err(|e| format!("failed to list agent keys: {e}"))?;

    Ok(keys.iter().map(|k| {
        AgentIdentityInfo {
            key_type: k.algorithm().to_string(),
            fingerprint: k.fingerprint(Default::default()).to_string(),
            comment: k.comment().to_string(),
        }
    }).collect())
}

// session

pub struct SshSession {
    handle: client::Handle<SshHandler>,
}

impl SshSession {
    pub async fn connect(
        host: &str,
        port: u16,
        username: &str,
        key_path: &str,
        passphrase: Option<String>,
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

        let pp_ref = passphrase.as_deref();
        let key = load_secret_key(&expanded_path, pp_ref)
            .map_err(|e| {
                let msg = format!("{e}");
                let lower = msg.to_lowercase();
                if pp_ref.is_none()
                    && (lower.contains("encrypt")
                        || lower.contains("passphrase")
                        || lower.contains("decrypt"))
                {
                    "ENCRYPTED_KEY".to_string()
                } else {
                    format!("Failed to load SSH key '{}': {e}", expanded_path)
                }
            })?;

        let config = Arc::new(client::Config {
            inactivity_timeout: Some(std::time::Duration::from_secs(30)),
            keepalive_interval: Some(std::time::Duration::from_secs(15)),
            keepalive_max: 3,
            ..Default::default()
        });

        let known_hosts = crate::config::known_hosts_path()
            .unwrap_or_else(|_| PathBuf::from(".ssh/known_hosts"));
        let handler = SshHandler {
            known_hosts_path: known_hosts,
            host: host.to_string(),
        };
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

    /// connect using the system SSH agent. runs on a blocking thread because
    /// russh's Signer trait returns impl Future without + Send, so the auth
    /// future can't cross a tokio::spawn boundary. block_on with the current
    /// runtime handle keeps everything on the same executor.
    pub async fn connect_with_agent(
        host: &str,
        port: u16,
        username: &str,
    ) -> Result<Self, String> {
        let host = host.to_owned();
        let port = port;
        let username = username.to_owned();
        let rt = tokio::runtime::Handle::current();

        tokio::task::spawn_blocking(move || {
            rt.block_on(async move {
                let mut agent = connect_agent().await?;
                let keys = agent.request_identities().await
                    .map_err(|e| format!("failed to list agent keys: {e}"))?;

                if keys.is_empty() {
                    return Err("no keys loaded in SSH agent".to_string());
                }

                let config = Arc::new(client::Config {
                    inactivity_timeout: Some(std::time::Duration::from_secs(30)),
                    keepalive_interval: Some(std::time::Duration::from_secs(15)),
                    keepalive_max: 3,
                    ..Default::default()
                });

                let known_hosts = crate::config::known_hosts_path()
                    .unwrap_or_else(|_| PathBuf::from(".ssh/known_hosts"));
                let handler = SshHandler {
                    known_hosts_path: known_hosts,
                    host: host.clone(),
                };
                let mut handle = client::connect(config, (&host[..], port), handler)
                    .await
                    .map_err(|e| format!("SSH connection failed: {e}"))?;

                let best_hash = handle
                    .best_supported_rsa_hash()
                    .await
                    .map_err(|e| format!("Failed to negotiate hash: {e}"))?
                    .flatten();

                let key_count = keys.len();
                for key in keys {
                    let result = handle
                        .authenticate_publickey_with(&username, key, best_hash, &mut agent)
                        .await;
                    match result {
                        Ok(r) if r.success() => return Ok(SshSession { handle }),
                        _ => continue,
                    }
                }

                Err(format!(
                    "SSH agent auth rejected - none of the {key_count} keys were accepted"
                ))
            })
        })
        .await
        .map_err(|e| format!("agent auth task failed: {e}"))?
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

// channel io bridge

pub enum ChannelInput {
    Data(Vec<u8>),
    Resize { cols: u32, rows: u32 },
    Close,
}

/// bridges a russh channel to tauri events. returns a sender for
/// input/resize/close from the frontend
pub fn spawn_channel_io(
    app: AppHandle,
    session_id: String,
    channel_id: String,
    mut channel: Channel<client::Msg>,
) -> mpsc::Sender<ChannelInput> {
    let (tx, mut rx) = mpsc::channel::<ChannelInput>(256);

    tokio::spawn(async move {
        let mut user_closed = false;
        loop {
            tokio::select! {
                // data from remote -> frontend
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
                            // keep going
                        }
                        Some(ChannelMsg::Close) | None => {
                            let event = format!("terminal-closed-{channel_id}");
                            let _ = app.emit(&event, ());
                            if !user_closed {
                                // unexpected close, tell the frontend
                                let err_event = format!("session-error-{session_id}");
                                let _ = app.emit(&err_event, "Connection lost");
                            }
                            break;
                        }
                        _ => {}
                    }
                }
                // input from frontend -> ssh
                input = rx.recv() => {
                    match input {
                        Some(ChannelInput::Data(bytes)) => {
                            if let Err(e) = channel.data(&bytes[..]).await {
                                log::error!("Failed to write to channel: {e}");
                                let err_event = format!("session-error-{session_id}");
                                let _ = app.emit(&err_event, format!("Write failed: {e}"));
                                break;
                            }
                        }
                        Some(ChannelInput::Resize { cols, rows }) => {
                            let _ = channel.window_change(cols, rows, 0, 0).await;
                        }
                        Some(ChannelInput::Close) | None => {
                            user_closed = true;
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
