use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use serde::{Deserialize, Serialize};
use std::io::{Read, Write};
use tauri::{AppHandle, Emitter};
use tokio::sync::mpsc;

use crate::ssh::ChannelInput;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum LocalShellType {
    PowerShell,
    Cmd,
    Wsl,
}

impl LocalShellType {
    fn command(&self) -> CommandBuilder {
        match self {
            LocalShellType::PowerShell => CommandBuilder::new("powershell.exe"),
            LocalShellType::Cmd => CommandBuilder::new("cmd.exe"),
            LocalShellType::Wsl => CommandBuilder::new("wsl.exe"),
        }
    }
}

/// spawn a local shell process and bridge it to tauri events.
/// returns an input sender using the same ChannelInput protocol as ssh channels -
/// the frontend doesn't know the difference
pub fn spawn_local_shell(
    app: AppHandle,
    channel_id: String,
    shell_type: LocalShellType,
    cols: u16,
    rows: u16,
    cwd: Option<String>,
) -> Result<mpsc::Sender<ChannelInput>, String> {
    let pty_system = native_pty_system();

    let pair = pty_system
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("failed to open pty: {e}"))?;

    let mut cmd = shell_type.command();
    if let Some(ref dir) = cwd {
        cmd.cwd(dir);
    }

    let _child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("failed to spawn shell: {e}"))?;
    // drop slave end - we talk through the master
    drop(pair.slave);

    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("failed to clone pty reader: {e}"))?;
    let mut writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("failed to take pty writer: {e}"))?;

    let (tx, mut rx) = mpsc::channel::<ChannelInput>(256);

    // reader thread: blocking IO from pty -> tauri events
    let app_read = app.clone();
    let cid_read = channel_id.clone();
    std::thread::spawn(move || {
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    let text = String::from_utf8_lossy(&buf[..n]).to_string();
                    let _ = app_read.emit(&format!("terminal-output-{cid_read}"), text);
                }
                Err(e) => {
                    log::error!("pty read error: {e}");
                    break;
                }
            }
        }
        let _ = app_read.emit(&format!("terminal-closed-{cid_read}"), ());
    });

    // writer task: ChannelInput messages -> pty
    // keep master alive here for resize operations
    let master = pair.master;
    tokio::spawn(async move {
        while let Some(input) = rx.recv().await {
            match input {
                ChannelInput::Data(bytes) => {
                    if let Err(e) = writer.write_all(&bytes) {
                        log::error!("pty write error: {e}");
                        break;
                    }
                }
                ChannelInput::Resize { cols, rows } => {
                    let _ = master.resize(PtySize {
                        rows: rows as u16,
                        cols: cols as u16,
                        pixel_width: 0,
                        pixel_height: 0,
                    });
                }
                ChannelInput::Close => {
                    // dropping master + writer kills the pty
                    break;
                }
            }
        }
    });

    Ok(tx)
}

// local system stats via sysinfo

use sysinfo::System;

/// local machine stats, same struct as remote ssh stats so the frontend
/// doesn't need to know which kind of tab it's looking at
pub fn fetch_local_system_stats() -> crate::commands::SystemStats {
    let mut sys = System::new();
    sys.refresh_memory();
    sys.refresh_cpu_all();

    let memory_total_mb = sys.total_memory() / (1024 * 1024);
    let memory_used_mb = sys.used_memory() / (1024 * 1024);
    let memory_used_percent = if memory_total_mb > 0 {
        (memory_used_mb as f32 / memory_total_mb as f32) * 100.0
    } else {
        0.0
    };

    // disk stats for the main drive
    use sysinfo::Disks;
    let disks = Disks::new_with_refreshed_list();
    let (disk_total_gb, disk_used_percent) = disks
        .iter()
        .find(|d| {
            // on windows, find C: drive
            d.mount_point().to_str().map_or(false, |p| p.starts_with("C:") || p == "/")
        })
        .or_else(|| disks.iter().next())
        .map(|d| {
            let total = d.total_space() as f64 / (1024.0 * 1024.0 * 1024.0);
            let used = (d.total_space() - d.available_space()) as f64 / (1024.0 * 1024.0 * 1024.0);
            let percent = if total > 0.0 { (used / total) * 100.0 } else { 0.0 };
            (total as f32, percent as f32)
        })
        .unwrap_or((0.0, 0.0));

    // uptime
    let uptime_secs = System::uptime();
    let hours = uptime_secs / 3600;
    let mins = (uptime_secs % 3600) / 60;
    let uptime = format!("up {hours}h {mins}m");

    crate::commands::SystemStats {
        cpu_temp: None, // no easy cross-platform cpu temp
        memory_used_percent,
        memory_total_mb,
        disk_used_percent,
        disk_total_gb,
        uptime,
        net_rx_bytes: 0, // not tracking local network for now
        net_tx_bytes: 0,
        latency_ms: 0, // local, no latency
    }
}
