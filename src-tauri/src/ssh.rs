use russh::client;
use russh::keys::agent::client::{AgentClient, AgentStream};
use russh::keys::ssh_key::PublicKey;
use russh::keys::{load_secret_key, PrivateKeyWithHashAlg};
use russh::{Channel, ChannelMsg, Disconnect, Pty};
use serde::{Deserialize, Serialize};
use std::fs::OpenOptions;
use std::io::Write as _;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::sync::OnceLock;
use std::time::Instant;
use tauri::{AppHandle, Emitter};
use tokio::sync::{mpsc, oneshot};

fn preferred_term() -> String {
    std::env::var("TERM")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "xterm-256color".to_string())
}

fn default_pty_modes() -> Vec<(Pty, u32)> {
    vec![
        (Pty::VINTR, 3),
        (Pty::VQUIT, 28),
        (Pty::VERASE, 127),
        (Pty::VKILL, 21),
        (Pty::VEOF, 4),
        (Pty::VSTART, 17),
        (Pty::VSTOP, 19),
        (Pty::VSUSP, 26),
        (Pty::ICRNL, 1),
        (Pty::IXON, 1),
        (Pty::ISIG, 1),
        (Pty::ICANON, 1),
        (Pty::IEXTEN, 1),
        (Pty::ECHO, 1),
        (Pty::ECHOE, 1),
        (Pty::ECHOK, 1),
        (Pty::OPOST, 1),
        (Pty::ONLCR, 1),
        (Pty::CS8, 1),
        // OpenSSH sends a real tty snapshot. `&[]` turned out to be a great way to annoy Claude.
        (Pty::TTY_OP_ISPEED, 38_400),
        (Pty::TTY_OP_OSPEED, 38_400),
    ]
}

static SSH_DEBUG_ENABLED: AtomicBool = AtomicBool::new(false);
static SSH_DEBUG_LOG_PATH: OnceLock<PathBuf> = OnceLock::new();

pub(crate) fn init_ssh_debug(app: &AppHandle) -> Result<(), String> {
    let config = crate::config::load_config(app)?;
    SSH_DEBUG_ENABLED.store(config.ssh_debug, Ordering::Relaxed);

    let path = crate::config::config_path(app)?
        .parent()
        .ok_or_else(|| "Failed to resolve config directory".to_string())?
        .join("kurolink-ssh-debug.log");
    let _ = SSH_DEBUG_LOG_PATH.set(path);

    Ok(())
}

pub(crate) fn ssh_debug_enabled() -> bool {
    SSH_DEBUG_ENABLED.load(Ordering::Relaxed)
}

pub(crate) fn ssh_debug_log(message: impl AsRef<str>) {
    if !ssh_debug_enabled() {
        return;
    }

    let Some(path) = SSH_DEBUG_LOG_PATH.get() else {
        return;
    };
    let timestamp = match std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH) {
        Ok(duration) => duration.as_millis(),
        Err(_) => 0,
    };

    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(file, "[{timestamp}] {}", message.as_ref());
    }
}

fn debug_escape_bytes(bytes: &[u8]) -> String {
    const MAX_BYTES: usize = 160;

    let mut rendered = String::new();
    for &byte in bytes.iter().take(MAX_BYTES) {
        match byte {
            b'\r' => rendered.push_str("\\r"),
            b'\n' => rendered.push_str("\\n"),
            b'\t' => rendered.push_str("\\t"),
            0x1b => rendered.push_str("\\e"),
            0x20..=0x7e => rendered.push(byte as char),
            _ => {
                let _ = std::fmt::Write::write_fmt(&mut rendered, format_args!("\\x{byte:02x}"));
            }
        }
    }

    if bytes.len() > MAX_BYTES {
        let _ = std::fmt::Write::write_fmt(
            &mut rendered,
            format_args!("...(truncated {} bytes)", bytes.len() - MAX_BYTES),
        );
    }

    rendered
}

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
            let Some((entry_host, remaining)) = line.split_once(' ') else {
                continue;
            };

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

type DynAgent = AgentClient<Box<dyn AgentStream + Send + Unpin + 'static>>;

/// try all available agent sources on this platform and return the first
/// one that actually has keys loaded. falls back to any connectable agent
/// if none have keys (so the caller gets "no keys" instead of "no agent").
pub async fn connect_agent() -> Result<DynAgent, String> {
    #[cfg(windows)]
    {
        // gather every agent we can talk to
        let mut agents: Vec<DynAgent> = Vec::new();

        if let Ok(a) = AgentClient::connect_named_pipe(r"\\.\pipe\openssh-ssh-agent").await {
            agents.push(a.dynamic());
        }
        // 1password, gpg4win, etc. sometimes expose a custom named pipe
        // via SSH_AUTH_SOCK (it's a windows pipe path, not a unix socket)
        if let Ok(sock) = std::env::var("SSH_AUTH_SOCK") {
            if sock.starts_with(r"\\") {
                if let Ok(a) = AgentClient::connect_named_pipe(&sock).await {
                    agents.push(a.dynamic());
                }
            }
        }
        if let Ok(a) = AgentClient::connect_pageant().await {
            agents.push(a.dynamic());
        }

        if agents.is_empty() {
            return Err("no SSH agent found - start OpenSSH Authentication Agent \
                 service or Pageant"
                .into());
        }

        // prefer the first agent that actually has keys loaded
        let mut first = None;
        for mut agent in agents {
            match agent.request_identities().await {
                Ok(keys) if !keys.is_empty() => return Ok(agent),
                _ => {
                    if first.is_none() {
                        first = Some(agent);
                    }
                }
            }
        }

        // no keys anywhere - return whatever connected so the caller
        // gets "no keys" instead of "no agent"
        Ok(first.unwrap())
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
    let keys = agent
        .request_identities()
        .await
        .map_err(|e| format!("failed to list agent keys: {e}"))?;

    Ok(keys
        .iter()
        .map(|k| AgentIdentityInfo {
            key_type: k.algorithm().to_string(),
            fingerprint: k.fingerprint(Default::default()).to_string(),
            comment: k.comment().to_string(),
        })
        .collect())
}

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
        let key = load_secret_key(&expanded_path, pp_ref).map_err(|e| {
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

        let known_hosts =
            crate::config::known_hosts_path().unwrap_or_else(|_| PathBuf::from(".ssh/known_hosts"));
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
    pub async fn connect_with_agent(host: &str, port: u16, username: &str) -> Result<Self, String> {
        let host = host.to_owned();
        let port = port;
        let username = username.to_owned();
        let rt = tokio::runtime::Handle::current();

        tokio::task::spawn_blocking(move || {
            rt.block_on(async move {
                let mut agent = connect_agent().await?;
                let keys = agent
                    .request_identities()
                    .await
                    .map_err(|e| format!("failed to list agent keys: {e}"))?;

                if keys.is_empty() {
                    return Err("SSH agent is running but has no keys loaded. \
                         Try running 'ssh-add' to add your key, or check \
                         that the correct agent is running"
                        .to_string());
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
        let term = preferred_term();
        let terminal_modes = default_pty_modes();
        ssh_debug_log(format!(
            "open_shell start term={term} cols={cols} rows={rows} modes={terminal_modes:?}"
        ));
        let channel = self
            .handle
            .channel_open_session()
            .await
            .map_err(|e| format!("Failed to open channel: {e}"))?;

        channel
            .request_pty(true, &term, cols, rows, 0, 0, &terminal_modes)
            .await
            .map_err(|e| format!("Failed to request PTY: {e}"))?;
        ssh_debug_log("open_shell request_pty ok");

        channel
            .request_shell(true)
            .await
            .map_err(|e| format!("Failed to request shell: {e}"))?;
        ssh_debug_log("open_shell request_shell ok");

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
) -> (mpsc::Sender<ChannelInput>, oneshot::Sender<()>) {
    let (tx, mut rx) = mpsc::channel::<ChannelInput>(256);
    let (start_tx, start_rx) = oneshot::channel::<()>();
    ssh_debug_log(format!(
        "spawn_channel_io channel={channel_id} session={session_id}"
    ));

    tokio::spawn(async move {
        let mut user_closed = false;
        ssh_debug_log(format!("channel={channel_id} waiting_for_channel_ready"));
        let _ = start_rx.await;
        ssh_debug_log(format!("channel={channel_id} channel_ready_received"));

        loop {
            tokio::select! {
                // data from remote -> frontend
                msg = channel.wait() => {
                    match msg {
                        Some(ChannelMsg::Data { data }) => {
                            ssh_debug_log(format!(
                                "channel={channel_id} recv stdout len={} data={}",
                                data.len(),
                                debug_escape_bytes(&data),
                            ));
                            let text = String::from_utf8_lossy(&data).to_string();
                            let event = format!("terminal-output-{channel_id}");
                            let _ = app.emit(&event, text);
                        }
                        Some(ChannelMsg::ExtendedData { data, .. }) => {
                            ssh_debug_log(format!(
                                "channel={channel_id} recv stderr len={} data={}",
                                data.len(),
                                debug_escape_bytes(&data),
                            ));
                            let text = String::from_utf8_lossy(&data).to_string();
                            let event = format!("terminal-output-{channel_id}");
                            let _ = app.emit(&event, text);
                        }
                        Some(ChannelMsg::ExitStatus { .. }) | Some(ChannelMsg::Eof) => {
                            ssh_debug_log(format!("channel={channel_id} recv eof_or_exit_status"));
                            // keep going
                        }
                        Some(ChannelMsg::Close) | None => {
                            ssh_debug_log(format!("channel={channel_id} recv close user_closed={user_closed}"));
                            let event = format!("terminal-closed-{channel_id}");
                            let _ = app.emit(&event, ());
                            if !user_closed {
                                // unexpected close, tell the frontend
                                let err_event = format!("session-error-{session_id}");
                                let _ = app.emit(&err_event, "Connection lost");
                            }
                            break;
                        }
                        Some(other) => {
                            ssh_debug_log(format!("channel={channel_id} recv other={other:?}"));
                        }
                    }
                }
                // input from frontend -> ssh
                input = rx.recv() => {
                    match input {
                        Some(ChannelInput::Data(bytes)) => {
                            ssh_debug_log(format!(
                                "channel={channel_id} send stdin len={} data={}",
                                bytes.len(),
                                debug_escape_bytes(&bytes),
                            ));
                            if let Err(e) = channel.data(&bytes[..]).await {
                                log::error!("Failed to write to channel: {e}");
                                let err_event = format!("session-error-{session_id}");
                                let _ = app.emit(&err_event, format!("Write failed: {e}"));
                                break;
                            }
                        }
                        Some(ChannelInput::Resize { cols, rows }) => {
                            ssh_debug_log(format!("channel={channel_id} resize cols={cols} rows={rows}"));
                            let _ = channel.window_change(cols, rows, 0, 0).await;
                        }
                        Some(ChannelInput::Close) | None => {
                            user_closed = true;
                            ssh_debug_log(format!("channel={channel_id} close_requested"));
                            let _ = channel.close().await;
                            break;
                        }
                    }
                }
            }
        }
    });

    (tx, start_tx)
}

#[cfg(test)]
mod tests {
    use super::default_pty_modes;
    use russh::Pty;

    #[test]
    fn default_pty_modes_include_signal_and_line_discipline_flags() {
        let modes = default_pty_modes();

        assert!(modes.contains(&(Pty::VINTR, 3)));
        assert!(modes.contains(&(Pty::VSUSP, 26)));
        assert!(modes.contains(&(Pty::ISIG, 1)));
        assert!(modes.contains(&(Pty::ICANON, 1)));
        assert!(modes.contains(&(Pty::ECHO, 1)));
        assert!(modes.contains(&(Pty::TTY_OP_ISPEED, 38_400)));
        assert!(modes.contains(&(Pty::TTY_OP_OSPEED, 38_400)));
        assert!(!modes.iter().any(|(mode, _)| *mode == Pty::TTY_OP_END));
    }
}
