use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};

use crate::config::ConnectionProfile;
use crate::ssh::{self, ChannelInput, SshSession};
use crate::state::{ActiveChannel, ActiveSession, AppState, ChannelKind};

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

// connection

#[tauri::command]
pub async fn probe_host(
    host: String,
    port: u16,
    username: String,
    key_path: String,
) -> Result<HostStatus, String> {
    // Try to connect and gather stats
    let result = probe_host_inner(&host, port, &username, &key_path).await;
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
    host: &str,
    port: u16,
    username: &str,
    key_path: &str,
) -> Result<HostStatus, String> {
    let mut session = SshSession::connect(host, port, username, key_path, None).await?;

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
) -> Result<String, String> {
    let session = SshSession::connect(&host, port, &username, &key_path, passphrase.as_deref()).await?;
    let session_id = uuid::Uuid::new_v4().to_string();

    // Update last_connected on the profile
    let mut config = state.get_config(&app).await?;
    if let Some(profile) = config.profiles.iter_mut().find(|p| p.id == profile_id) {
        profile.last_connected = Some(chrono_now());
    }
    config.last_profile_id = Some(profile_id.clone());
    state.update_config(&app, config).await?;

    let active = ActiveSession {
        session_id: session_id.clone(),
        profile_id,
        ssh: session,
        channels: std::collections::HashMap::new(),
    };

    state.sessions.lock().await.insert(session_id.clone(), active);
    Ok(session_id)
}

#[tauri::command]
pub async fn disconnect_ssh(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<(), String> {
    let mut sessions = state.sessions.lock().await;
    if let Some(mut session) = sessions.remove(&session_id) {
        // close all channels
        for (_, channel) in session.channels.drain() {
            match channel.kind {
                ChannelKind::Shell { input_tx } => {
                    let _ = input_tx.send(ChannelInput::Close).await;
                }
            }
        }
        let _ = session.ssh.disconnect().await;
    }
    Ok(())
}

// terminal

#[tauri::command]
pub async fn open_shell(
    app: AppHandle,
    state: State<'_, AppState>,
    session_id: String,
    cols: u32,
    rows: u32,
) -> Result<String, String> {
    let mut sessions = state.sessions.lock().await;
    let session = sessions
        .get_mut(&session_id)
        .ok_or("Session not found")?;

    let channel = session.ssh.open_shell(cols, rows).await?;
    let channel_id = uuid::Uuid::new_v4().to_string();

    let input_tx = ssh::spawn_channel_io(app, session_id.clone(), channel_id.clone(), channel);

    session.channels.insert(
        channel_id.clone(),
        ActiveChannel {
            channel_id: channel_id.clone(),
            kind: ChannelKind::Shell { input_tx },
        },
    );

    Ok(channel_id)
}

#[tauri::command]
pub async fn close_shell(
    state: State<'_, AppState>,
    session_id: String,
    channel_id: String,
) -> Result<(), String> {
    let mut sessions = state.sessions.lock().await;
    let session = sessions
        .get_mut(&session_id)
        .ok_or("Session not found")?;

    if let Some(channel) = session.channels.remove(&channel_id) {
        match channel.kind {
            ChannelKind::Shell { input_tx } => {
                let _ = input_tx.send(ChannelInput::Close).await;
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn write_to_shell(
    state: State<'_, AppState>,
    session_id: String,
    channel_id: String,
    data: String,
) -> Result<(), String> {
    let sessions = state.sessions.lock().await;
    let session = sessions
        .get(&session_id)
        .ok_or("Session not found")?;
    let channel = session
        .channels
        .get(&channel_id)
        .ok_or("Channel not found")?;

    match &channel.kind {
        ChannelKind::Shell { input_tx } => {
            input_tx
                .send(ChannelInput::Data(data.into_bytes()))
                .await
                .map_err(|e| format!("Failed to send data: {e}"))
        }
    }
}

#[tauri::command]
pub async fn resize_shell(
    state: State<'_, AppState>,
    session_id: String,
    channel_id: String,
    cols: u32,
    rows: u32,
) -> Result<(), String> {
    let sessions = state.sessions.lock().await;
    let session = sessions
        .get(&session_id)
        .ok_or("Session not found")?;
    let channel = session
        .channels
        .get(&channel_id)
        .ok_or("Channel not found")?;

    match &channel.kind {
        ChannelKind::Shell { input_tx } => {
            input_tx
                .send(ChannelInput::Resize { cols, rows })
                .await
                .map_err(|e| format!("Failed to send resize: {e}"))
        }
    }
}

#[tauri::command]
pub async fn ping_session(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<u64, String> {
    let mut sessions = state.sessions.lock().await;
    let session = sessions
        .get_mut(&session_id)
        .ok_or("Session not found")?;
    session.ssh.ping().await
}

// stats

#[tauri::command]
pub async fn fetch_system_stats(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<SystemStats, String> {
    let mut sessions = state.sessions.lock().await;
    let session = sessions
        .get_mut(&session_id)
        .ok_or("Session not found")?;

    let thermal_zone = detect_thermal_zone(&mut session.ssh).await;
    let cpu_temp = session
        .ssh
        .exec_command(&format!("cat {thermal_zone}/temp"))
        .await
        .ok()
        .and_then(|s| s.trim().parse::<f32>().ok())
        .map(|t| t / 1000.0);

    let mem_output = session
        .ssh
        .exec_command("free -m | awk 'NR==2{print $2, $3}'")
        .await
        .unwrap_or_default();
    let mem_parts: Vec<&str> = mem_output.trim().split_whitespace().collect();
    let memory_total_mb: u64 = mem_parts.first().and_then(|s| s.parse().ok()).unwrap_or(0);
    let memory_used_mb: u64 = mem_parts.get(1).and_then(|s| s.parse().ok()).unwrap_or(0);
    let memory_used_percent = if memory_total_mb > 0 {
        (memory_used_mb as f32 / memory_total_mb as f32) * 100.0
    } else {
        0.0
    };

    let disk_output = session
        .ssh
        .exec_command("df / | awk 'NR==2{print $2, $3}'")
        .await
        .unwrap_or_default();
    let disk_parts: Vec<&str> = disk_output.trim().split_whitespace().collect();
    let disk_total_kb: f32 = disk_parts.first().and_then(|s| s.parse().ok()).unwrap_or(0.0);
    let disk_used_kb: f32 = disk_parts.get(1).and_then(|s| s.parse().ok()).unwrap_or(0.0);
    let disk_total_gb = disk_total_kb / 1_048_576.0;
    let disk_used_percent = if disk_total_kb > 0.0 {
        (disk_used_kb / disk_total_kb) * 100.0
    } else {
        0.0
    };

    let uptime = session
        .ssh
        .exec_command("uptime -p")
        .await
        .unwrap_or_else(|_| "unknown".to_string())
        .trim()
        .to_string();

    let net_iface = detect_net_iface(&mut session.ssh).await;
    let net_rx_bytes: u64 = session
        .ssh
        .exec_command(&format!("cat /sys/class/net/{net_iface}/statistics/rx_bytes 2>/dev/null || echo 0"))
        .await
        .unwrap_or_else(|_| "0".to_string())
        .trim()
        .parse()
        .unwrap_or(0);

    let net_tx_bytes: u64 = session
        .ssh
        .exec_command(&format!("cat /sys/class/net/{net_iface}/statistics/tx_bytes 2>/dev/null || echo 0"))
        .await
        .unwrap_or_else(|_| "0".to_string())
        .trim()
        .parse()
        .unwrap_or(0);

    Ok(SystemStats {
        cpu_temp,
        memory_used_percent,
        memory_total_mb,
        disk_used_percent,
        disk_total_gb,
        uptime,
        net_rx_bytes,
        net_tx_bytes,
    })
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

async fn detect_net_iface(ssh: &mut SshSession) -> String {
    ssh.exec_command("ip route show default | awk '{print $5}' | head -1")
        .await
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "eth0".to_string())
}
