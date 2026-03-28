use serde::{Deserialize, Serialize};
use std::time::Instant;
use tauri::{AppHandle, State};

use crate::config::ConnectionProfile;
use crate::local::{self, LocalShellType};
use crate::ssh::{self, AgentIdentityInfo, ChannelInput, SshSession};
use crate::state::{ActiveChannel, AppState, ChannelBackend, SshSessionEntry};

// types

#[derive(Serialize, Deserialize, Clone)]
pub struct HostStatus {
    pub reachable: bool,
    pub latency_ms: Option<u64>,
    pub uptime: Option<String>,
    pub cpu_temp: Option<f32>,
    pub memory_used: Option<f32>,
    pub memory_total: Option<String>,
    pub disk_used: Option<f32>,
    pub disk_total: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct SystemStats {
    pub cpu_temp: Option<f32>,
    pub memory_used_percent: f32,
    pub memory_total_mb: u64,
    pub disk_used_percent: f32,
    pub disk_total_gb: f32,
    pub uptime: String,
    pub net_rx_bytes: u64,
    pub net_tx_bytes: u64,
    pub latency_ms: u64,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct OpenSshShellResult {
    pub channel_id: String,
    pub session_id: String,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct SessionInfo {
    pub session_id: String,
    pub profile_id: String,
    pub profile_name: String,
    pub channel_count: usize,
}

// config

#[tauri::command]
pub async fn get_profiles(app: AppHandle, state: State<'_, AppState>) -> Result<Vec<ConnectionProfile>, String> {
    let config = state.get_config(&app).await?;
    Ok(config.profiles)
}

#[tauri::command]
pub async fn save_profile(app: AppHandle, state: State<'_, AppState>, profile: ConnectionProfile) -> Result<(), String> {
    let mut config = state.get_config(&app).await?;

    if let Some(existing) = config.profiles.iter_mut().find(|p| p.id == profile.id) {
        *existing = profile;
    } else {
        config.profiles.push(profile);
    }

    state.update_config(&app, config).await
}

#[tauri::command]
pub async fn delete_profile(app: AppHandle, state: State<'_, AppState>, profile_id: String) -> Result<(), String> {
    let mut config = state.get_config(&app).await?;
    config.profiles.retain(|p| p.id != profile_id);
    if config.last_profile_id.as_deref() == Some(&profile_id) {
        config.last_profile_id = None;
    }
    state.update_config(&app, config).await
}

#[tauri::command]
pub async fn get_last_profile(app: AppHandle, state: State<'_, AppState>) -> Result<Option<ConnectionProfile>, String> {
    let config = state.get_config(&app).await?;
    let profile = config
        .last_profile_id
        .and_then(|id| config.profiles.into_iter().find(|p| p.id == id));
    Ok(profile)
}

// passphrase

#[tauri::command]
pub async fn encrypt_profile_passphrase(
    app: AppHandle,
    plaintext: String,
) -> Result<String, String> {
    crate::config::encrypt_passphrase(&app, &plaintext)
}

#[tauri::command]
pub async fn decrypt_profile_passphrase(
    app: AppHandle,
    encrypted: String,
) -> Result<String, String> {
    crate::config::decrypt_passphrase(&app, &encrypted)
}

// agent

#[tauri::command]
pub async fn detect_agent() -> Result<bool, String> {
    let rt = tokio::runtime::Handle::current();
    tokio::task::spawn_blocking(move || {
        rt.block_on(async { ssh::connect_agent().await.map(|_| true) })
    })
    .await
    .map_err(|e| format!("agent detect failed: {e}"))?
}

#[tauri::command]
pub async fn list_agent_identities() -> Result<Vec<AgentIdentityInfo>, String> {
    let rt = tokio::runtime::Handle::current();
    tokio::task::spawn_blocking(move || {
        rt.block_on(ssh::list_agent_keys())
    })
    .await
    .map_err(|e| format!("agent list failed: {e}"))?
}

// connection

#[tauri::command]
pub async fn probe_host(
    host: String,
    port: u16,
    username: String,
    key_path: String,
    passphrase: Option<String>,
    auth_mode: Option<String>,
) -> Result<HostStatus, String> {
    let use_agent = auth_mode.as_deref() == Some("agent");
    let result = probe_host_inner(host, port, username, key_path, passphrase, use_agent).await;
    match result {
        Ok(status) => Ok(status),
        Err(_) => Ok(HostStatus {
            reachable: false,
            latency_ms: None,
            uptime: None,
            cpu_temp: None,
            memory_used: None,
            memory_total: None,
            disk_used: None,
            disk_total: None,
        }),
    }
}

async fn probe_host_inner(
    host: String,
    port: u16,
    username: String,
    key_path: String,
    passphrase: Option<String>,
    use_agent: bool,
) -> Result<HostStatus, String> {
    let mut session = if use_agent {
        SshSession::connect_with_agent(&host, port, &username).await?
    } else {
        SshSession::connect(&host, port, &username, &key_path, passphrase).await?
    };

    let latency = session.ping().await?;

    let uptime = session
        .exec_command("uptime -p")
        .await
        .ok()
        .map(|s| s.trim().to_string());

    let thermal_zone = detect_thermal_zone(&mut session).await;
    let cpu_temp = session
        .exec_command(&format!("cat {thermal_zone}/temp"))
        .await
        .ok()
        .and_then(|s| s.trim().parse::<f32>().ok())
        .map(|t| t / 1000.0);

    let (memory_used, memory_total) = parse_memory(
        &session.exec_command("free -m | awk 'NR==2{print $2, $3}'").await.unwrap_or_default(),
    );

    let (disk_used, disk_total) = parse_disk(
        &session.exec_command("df -h / | awk 'NR==2{print $2, $5}'").await.unwrap_or_default(),
    );

    let _ = session.disconnect().await;

    Ok(HostStatus {
        reachable: true,
        latency_ms: Some(latency),
        uptime,
        cpu_temp,
        memory_used,
        memory_total,
        disk_used,
        disk_total,
    })
}

/// connect to an ssh host (or reuse existing session) and return sessionId.
/// still used by ConnectionScreen for the initial boot connection
#[tauri::command]
pub async fn connect_ssh(
    app: AppHandle,
    state: State<'_, AppState>,
    profile_id: String,
    host: String,
    port: u16,
    username: String,
    key_path: String,
    passphrase: Option<String>,
    auth_mode: Option<String>,
) -> Result<String, String> {
    let use_agent = auth_mode.as_deref() == Some("agent");
    let session = if use_agent {
        SshSession::connect_with_agent(&host, port, &username).await?
    } else {
        SshSession::connect(&host, port, &username, &key_path, passphrase).await?
    };
    let session_id = uuid::Uuid::new_v4().to_string();

    // update last_connected on the profile
    let mut config = state.get_config(&app).await?;
    if let Some(profile) = config.profiles.iter_mut().find(|p| p.id == profile_id) {
        profile.last_connected = Some(chrono_now());
    }
    config.last_profile_id = Some(profile_id.clone());
    state.update_config(&app, config).await?;

    let entry = SshSessionEntry {
        session_id: session_id.clone(),
        profile_id,
        ssh: session,
        channel_count: 0,
    };

    state.ssh_sessions.lock().await.insert(session_id.clone(), entry);
    Ok(session_id)
}

#[tauri::command]
pub async fn disconnect_ssh(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<(), String> {
    // remove all channels belonging to this session
    let mut channels = state.channels.lock().await;
    let to_remove: Vec<String> = channels
        .iter()
        .filter(|(_, ch)| ch.session_id() == Some(&session_id))
        .map(|(id, _)| id.clone())
        .collect();
    for id in &to_remove {
        if let Some(ch) = channels.remove(id) {
            let _ = ch.input_tx().send(ChannelInput::Close).await;
        }
    }
    drop(channels);

    // disconnect the ssh session
    let mut sessions = state.ssh_sessions.lock().await;
    if let Some(mut entry) = sessions.remove(&session_id) {
        let _ = entry.ssh.disconnect().await;
    }
    Ok(())
}

// terminal - shell operations (backend-agnostic, only need channel_id)

/// open a shell channel on an existing ssh session.
/// used by the initial connection flow (ConnectionScreen -> first tab)
#[tauri::command]
pub async fn open_shell(
    app: AppHandle,
    state: State<'_, AppState>,
    session_id: String,
    cols: u32,
    rows: u32,
) -> Result<String, String> {
    let mut sessions = state.ssh_sessions.lock().await;
    let entry = sessions
        .get_mut(&session_id)
        .ok_or("Session not found")?;

    let channel = entry.ssh.open_shell(cols, rows).await?;
    let channel_id = uuid::Uuid::new_v4().to_string();

    let input_tx = ssh::spawn_channel_io(app, session_id.clone(), channel_id.clone(), channel);
    entry.channel_count += 1;

    let active = ActiveChannel {
        channel_id: channel_id.clone(),
        backend: ChannelBackend::Ssh {
            session_id: session_id.clone(),
            input_tx,
        },
        start_signal: None,
    };
    drop(sessions); // release ssh lock before acquiring channels lock
    state.channels.lock().await.insert(channel_id.clone(), active);

    Ok(channel_id)
}

/// connect to a profile (or reuse existing session) and open a shell in one call.
/// used by the tab dropdown for opening new ssh tabs after initial connection
#[tauri::command]
pub async fn open_ssh_shell(
    app: AppHandle,
    state: State<'_, AppState>,
    profile_id: String,
    cols: u32,
    rows: u32,
    passphrase: Option<String>,
) -> Result<OpenSshShellResult, String> {
    let mut sessions = state.ssh_sessions.lock().await;

    // check for existing session to this profile
    let existing_sid = sessions
        .values()
        .find(|e| e.profile_id == profile_id)
        .map(|e| e.session_id.clone());

    if let Some(sid) = existing_sid {
        // reuse existing session
        let entry = sessions.get_mut(&sid).unwrap();
        let channel = entry.ssh.open_shell(cols, rows).await?;
        let channel_id = uuid::Uuid::new_v4().to_string();

        let input_tx = ssh::spawn_channel_io(
            app, sid.clone(), channel_id.clone(), channel,
        );
        entry.channel_count += 1;

        let active = ActiveChannel {
            channel_id: channel_id.clone(),
            backend: ChannelBackend::Ssh {
                session_id: sid.clone(),
                input_tx,
            },
            start_signal: None,
        };
        drop(sessions);
        state.channels.lock().await.insert(channel_id.clone(), active);

        return Ok(OpenSshShellResult {
            channel_id,
            session_id: sid,
        });
    }

    drop(sessions); // release lock while we connect

    // need to create a new session - load profile from config
    let config = state.get_config(&app).await?;
    let profile = config
        .profiles
        .iter()
        .find(|p| p.id == profile_id)
        .ok_or("Profile not found")?
        .clone();

    // figure out auth
    let use_agent = profile.auth_mode == crate::config::AuthMode::Agent;
    let pp = if !use_agent && profile.has_passphrase {
        // try saved passphrase first, fall back to provided one
        if let Some(ref encrypted) = profile.saved_passphrase {
            crate::config::decrypt_passphrase(&app, encrypted).ok()
        } else {
            passphrase
        }
    } else {
        None
    };

    let session = if use_agent {
        SshSession::connect_with_agent(&profile.host, profile.port, &profile.username).await?
    } else {
        SshSession::connect(
            &profile.host,
            profile.port,
            &profile.username,
            &profile.key_path,
            pp,
        )
        .await?
    };

    let session_id = uuid::Uuid::new_v4().to_string();

    // update last_connected
    let mut cfg = state.get_config(&app).await?;
    if let Some(p) = cfg.profiles.iter_mut().find(|p| p.id == profile_id) {
        p.last_connected = Some(chrono_now());
    }
    cfg.last_profile_id = Some(profile_id.clone());
    state.update_config(&app, cfg).await?;

    // open shell on the new session
    let mut ssh_session = session;
    let channel = ssh_session.open_shell(cols, rows).await?;
    let channel_id = uuid::Uuid::new_v4().to_string();

    let input_tx = ssh::spawn_channel_io(
        app, session_id.clone(), channel_id.clone(), channel,
    );

    let entry = SshSessionEntry {
        session_id: session_id.clone(),
        profile_id,
        ssh: ssh_session,
        channel_count: 1,
    };

    state.ssh_sessions.lock().await.insert(session_id.clone(), entry);
    state.channels.lock().await.insert(
        channel_id.clone(),
        ActiveChannel {
            channel_id: channel_id.clone(),
            backend: ChannelBackend::Ssh {
                session_id: session_id.clone(),
                input_tx,
            },
            start_signal: None,
        },
    );

    Ok(OpenSshShellResult {
        channel_id,
        session_id,
    })
}

/// spawn a local shell (powershell, cmd, wsl)
#[tauri::command]
pub async fn open_local_shell(
    app: AppHandle,
    state: State<'_, AppState>,
    shell_type: String,
    cols: u32,
    rows: u32,
    cwd: Option<String>,
) -> Result<String, String> {
    let shell = match shell_type.as_str() {
        "powershell" => LocalShellType::PowerShell,
        "cmd" => LocalShellType::Cmd,
        "wsl" => LocalShellType::Wsl,
        other => return Err(format!("unknown shell type: {other}")),
    };

    let channel_id = uuid::Uuid::new_v4().to_string();
    let (input_tx, start_signal) = local::spawn_local_shell(
        app,
        channel_id.clone(),
        shell,
        cols as u16,
        rows as u16,
        cwd,
    )?;

    state.channels.lock().await.insert(
        channel_id.clone(),
        ActiveChannel {
            channel_id: channel_id.clone(),
            backend: ChannelBackend::Local { input_tx },
            start_signal: Some(start_signal),
        },
    );

    Ok(channel_id)
}

/// tell a local shell "the frontend listener is ready, start pushing output"
#[tauri::command]
pub async fn channel_ready(
    state: State<'_, AppState>,
    channel_id: String,
) -> Result<(), String> {
    let mut channels = state.channels.lock().await;
    if let Some(channel) = channels.get_mut(&channel_id) {
        if let Some(signal) = channel.start_signal.take() {
            let _ = signal.send(());
        }
    }
    Ok(())
}

/// close any channel (ssh or local) - just needs channel_id
#[tauri::command]
pub async fn close_shell(
    state: State<'_, AppState>,
    channel_id: String,
) -> Result<(), String> {
    let mut channels = state.channels.lock().await;
    if let Some(channel) = channels.remove(&channel_id) {
        let _ = channel.input_tx().send(ChannelInput::Close).await;

        // decrement ssh session refcount if applicable
        if let Some(sid) = channel.session_id() {
            let mut sessions = state.ssh_sessions.lock().await;
            if let Some(entry) = sessions.get_mut(sid) {
                entry.channel_count = entry.channel_count.saturating_sub(1);
            }
        }
    }
    Ok(())
}

/// write data to any channel - backend-agnostic
#[tauri::command]
pub async fn write_to_shell(
    state: State<'_, AppState>,
    channel_id: String,
    data: String,
) -> Result<(), String> {
    let channels = state.channels.lock().await;
    let channel = channels
        .get(&channel_id)
        .ok_or("Channel not found")?;

    channel
        .input_tx()
        .send(ChannelInput::Data(data.into_bytes()))
        .await
        .map_err(|e| format!("Failed to send data: {e}"))
}

/// resize any channel - backend-agnostic
#[tauri::command]
pub async fn resize_shell(
    state: State<'_, AppState>,
    channel_id: String,
    cols: u32,
    rows: u32,
) -> Result<(), String> {
    let channels = state.channels.lock().await;
    let channel = channels
        .get(&channel_id)
        .ok_or("Channel not found")?;

    channel
        .input_tx()
        .send(ChannelInput::Resize { cols, rows })
        .await
        .map_err(|e| format!("Failed to send resize: {e}"))
}

#[tauri::command]
pub async fn ping_session(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<u64, String> {
    let mut sessions = state.ssh_sessions.lock().await;
    let entry = sessions
        .get_mut(&session_id)
        .ok_or("Session not found")?;
    entry.ssh.ping().await
}

/// list active ssh sessions (for the frontend to know what's connected)
#[tauri::command]
pub async fn get_active_sessions(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Vec<SessionInfo>, String> {
    let sessions = state.ssh_sessions.lock().await;
    let config = state.get_config(&app).await?;

    Ok(sessions
        .values()
        .map(|entry| {
            let profile_name = config
                .profiles
                .iter()
                .find(|p| p.id == entry.profile_id)
                .map(|p| p.name.clone())
                .unwrap_or_else(|| "Unknown".to_string());

            SessionInfo {
                session_id: entry.session_id.clone(),
                profile_id: entry.profile_id.clone(),
                profile_name,
                channel_count: entry.channel_count,
            }
        })
        .collect())
}

// stats

// one big script so we only open one channel and hold the lock briefly
const STATS_SCRIPT: &str = r#"
TZONE=$(for z in /sys/class/thermal/thermal_zone*/type; do
  [ "$(cat "$z" 2>/dev/null)" = "cpu-thermal" ] && dirname "$z" && break
done)
[ -z "$TZONE" ] && TZONE=/sys/class/thermal/thermal_zone0
echo "TEMP:$(cat "$TZONE/temp" 2>/dev/null || echo -1)"
echo "MEM:$(free -m | awk 'NR==2{print $2, $3}')"
echo "DISK:$(df / | awk 'NR==2{print $2, $3}')"
echo "UP:$(uptime -p 2>/dev/null || echo unknown)"
IFACE=$(ip route show default 2>/dev/null | awk '{print $5}' | head -1)
[ -z "$IFACE" ] && IFACE=eth0
echo "NETRX:$(cat /sys/class/net/$IFACE/statistics/rx_bytes 2>/dev/null || echo 0)"
echo "NETTX:$(cat /sys/class/net/$IFACE/statistics/tx_bytes 2>/dev/null || echo 0)"
"#;

#[tauri::command]
pub async fn fetch_system_stats(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<SystemStats, String> {
    let mut sessions = state.ssh_sessions.lock().await;
    let entry = sessions
        .get_mut(&session_id)
        .ok_or("Session not found")?;

    // single round-trip, also doubles as latency measurement
    let start = Instant::now();
    let raw = entry.ssh.exec_command(STATS_SCRIPT).await.unwrap_or_default();
    let latency_ms = start.elapsed().as_millis() as u64;

    // parse tagged lines
    let mut cpu_temp: Option<f32> = None;
    let mut memory_total_mb: u64 = 0;
    let mut memory_used_mb: u64 = 0;
    let mut disk_total_kb: f32 = 0.0;
    let mut disk_used_kb: f32 = 0.0;
    let mut uptime = "unknown".to_string();
    let mut net_rx_bytes: u64 = 0;
    let mut net_tx_bytes: u64 = 0;

    for line in raw.lines() {
        let line = line.trim();
        if let Some(val) = line.strip_prefix("TEMP:") {
            if let Ok(t) = val.trim().parse::<f32>() {
                if t >= 0.0 { cpu_temp = Some(t / 1000.0); }
            }
        } else if let Some(val) = line.strip_prefix("MEM:") {
            let parts: Vec<&str> = val.trim().split_whitespace().collect();
            memory_total_mb = parts.first().and_then(|s| s.parse().ok()).unwrap_or(0);
            memory_used_mb = parts.get(1).and_then(|s| s.parse().ok()).unwrap_or(0);
        } else if let Some(val) = line.strip_prefix("DISK:") {
            let parts: Vec<&str> = val.trim().split_whitespace().collect();
            disk_total_kb = parts.first().and_then(|s| s.parse().ok()).unwrap_or(0.0);
            disk_used_kb = parts.get(1).and_then(|s| s.parse().ok()).unwrap_or(0.0);
        } else if let Some(val) = line.strip_prefix("UP:") {
            uptime = val.trim().to_string();
        } else if let Some(val) = line.strip_prefix("NETRX:") {
            net_rx_bytes = val.trim().parse().unwrap_or(0);
        } else if let Some(val) = line.strip_prefix("NETTX:") {
            net_tx_bytes = val.trim().parse().unwrap_or(0);
        }
    }

    let memory_used_percent = if memory_total_mb > 0 {
        (memory_used_mb as f32 / memory_total_mb as f32) * 100.0
    } else {
        0.0
    };
    let disk_total_gb = disk_total_kb / 1_048_576.0;
    let disk_used_percent = if disk_total_kb > 0.0 {
        (disk_used_kb / disk_total_kb) * 100.0
    } else {
        0.0
    };

    Ok(SystemStats {
        cpu_temp,
        memory_used_percent,
        memory_total_mb,
        disk_used_percent,
        disk_total_gb,
        uptime,
        net_rx_bytes,
        net_tx_bytes,
        latency_ms,
    })
}

/// local system stats - same struct, no ssh needed
#[tauri::command]
pub async fn fetch_local_stats() -> Result<SystemStats, String> {
    Ok(local::fetch_local_system_stats())
}

/// get the --path arg if KuroLink was launched with one
/// (for future "Open KuroLink here" context menu integration)
#[tauri::command]
pub async fn get_launch_path(state: State<'_, AppState>) -> Result<Option<String>, String> {
    Ok(state.launch_path.lock().await.clone())
}

// helpers

fn parse_memory(output: &str) -> (Option<f32>, Option<String>) {
    let parts: Vec<&str> = output.trim().split_whitespace().collect();
    let total: Option<f32> = parts.first().and_then(|s| s.parse().ok());
    let used: Option<f32> = parts.get(1).and_then(|s| s.parse().ok());
    let percent = match (total, used) {
        (Some(t), Some(u)) if t > 0.0 => Some((u / t) * 100.0),
        _ => None,
    };
    let total_str = total.map(|t| format!("{:.0} MB", t));
    (percent, total_str)
}

fn parse_disk(output: &str) -> (Option<f32>, Option<String>) {
    let parts: Vec<&str> = output.trim().split_whitespace().collect();
    let total_str = parts.first().map(|s| s.to_string());
    let used_percent = parts
        .get(1)
        .and_then(|s| s.trim_end_matches('%').parse::<f32>().ok());
    (used_percent, total_str)
}

fn chrono_now() -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    format!("{now}")
}

async fn detect_thermal_zone(ssh: &mut SshSession) -> String {
    ssh.exec_command(
        "for z in /sys/class/thermal/thermal_zone*/type; do \
         if [ \"$(cat \"$z\")\" = \"cpu-thermal\" ]; then dirname \"$z\"; break; fi; \
         done",
    )
    .await
    .map(|s| s.trim().to_string())
    .unwrap_or_else(|_| "/sys/class/thermal/thermal_zone0".to_string())
}

#[allow(dead_code)]
async fn detect_net_iface(ssh: &mut SshSession) -> String {
    ssh.exec_command("ip route show default | awk '{print $5}' | head -1")
        .await
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "eth0".to_string())
}
