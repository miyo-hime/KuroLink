use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use serde::{Deserialize, Serialize};
use std::io::{Read, Write};
#[cfg(windows)]
use std::os::windows::process::CommandExt;
use std::process::Command as ProcessCommand;
use tauri::{AppHandle, Emitter};
use tokio::sync::{mpsc, oneshot};

use crate::ssh::{decode_utf8_chunk, finish_utf8_chunk, ChannelInput};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum LocalShellType {
    #[serde(rename = "powershell")]
    PowerShell,
    Cmd,
    Wsl,
    Nu,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalShellInfo {
    pub id: String,
    pub label: String,
    pub short_label: String,
    pub subtitle: String,
    pub detected: bool,
    pub available: bool,
}

impl LocalShellType {
    pub fn from_id(id: &str) -> Option<Self> {
        match id {
            "powershell" => Some(LocalShellType::PowerShell),
            "cmd" => Some(LocalShellType::Cmd),
            "wsl" => Some(LocalShellType::Wsl),
            "nu" => Some(LocalShellType::Nu),
            _ => None,
        }
    }

    fn all() -> [Self; 4] {
        [
            LocalShellType::PowerShell,
            LocalShellType::Cmd,
            LocalShellType::Wsl,
            LocalShellType::Nu,
        ]
    }

    fn id(&self) -> &'static str {
        match self {
            LocalShellType::PowerShell => "powershell",
            LocalShellType::Cmd => "cmd",
            LocalShellType::Wsl => "wsl",
            LocalShellType::Nu => "nu",
        }
    }

    fn label(&self) -> &'static str {
        match self {
            LocalShellType::PowerShell => "PowerShell",
            LocalShellType::Cmd => "Command Prompt",
            LocalShellType::Wsl => "WSL",
            LocalShellType::Nu => "Nushell",
        }
    }

    fn short_label(&self) -> &'static str {
        match self {
            LocalShellType::PowerShell => "PS",
            LocalShellType::Cmd => "CMD",
            LocalShellType::Wsl => "WSL",
            LocalShellType::Nu => "NU",
        }
    }

    fn subtitle(&self) -> &'static str {
        match self {
            LocalShellType::PowerShell => "POWERSHELL",
            LocalShellType::Cmd => "PROMPT",
            LocalShellType::Wsl => "LINUX",
            LocalShellType::Nu => "NUSHELL",
        }
    }

    fn is_detected_shell(&self) -> bool {
        matches!(self, LocalShellType::Wsl | LocalShellType::Nu)
    }

    fn executable(&self) -> &'static str {
        match self {
            LocalShellType::PowerShell => "powershell.exe",
            LocalShellType::Cmd => "cmd.exe",
            LocalShellType::Wsl => "wsl.exe",
            LocalShellType::Nu if cfg!(windows) => "nu.exe",
            LocalShellType::Nu => "nu",
        }
    }

    fn command(&self) -> CommandBuilder {
        CommandBuilder::new(self.executable())
    }

    pub fn available(&self) -> bool {
        match self {
            LocalShellType::PowerShell | LocalShellType::Cmd => true,
            LocalShellType::Wsl => wsl_has_distro(),
            LocalShellType::Nu => command_succeeds(self.executable(), &["--version"]),
        }
    }

    fn info(&self) -> LocalShellInfo {
        LocalShellInfo {
            id: self.id().to_string(),
            label: self.label().to_string(),
            short_label: self.short_label().to_string(),
            subtitle: self.subtitle().to_string(),
            detected: self.is_detected_shell(),
            available: self.available(),
        }
    }
}

pub fn detect_local_shells() -> Vec<LocalShellInfo> {
    LocalShellType::all()
        .iter()
        .map(LocalShellType::info)
        .collect()
}

fn command_succeeds(command: &str, args: &[&str]) -> bool {
    let mut cmd = hidden_probe_command(command);
    cmd.args(args)
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false)
}

fn wsl_has_distro() -> bool {
    let output = match hidden_probe_command("wsl.exe").args(["-l", "-q"]).output() {
        Ok(output) if output.status.success() => output,
        _ => return false,
    };
    let stdout = decode_shell_probe_output(&output.stdout);
    stdout.lines().any(|line| !line.trim().is_empty())
}

fn hidden_probe_command(command: &str) -> ProcessCommand {
    let mut cmd = ProcessCommand::new(command);
    #[cfg(windows)]
    cmd.creation_flags(0x08000000);
    cmd
}

fn decode_shell_probe_output(bytes: &[u8]) -> String {
    if bytes.len() > 1 && bytes[1] == 0 {
        let units: Vec<u16> = bytes
            .chunks_exact(2)
            .map(|chunk| u16::from_le_bytes([chunk[0], chunk[1]]))
            .collect();
        String::from_utf16_lossy(&units)
    } else {
        String::from_utf8_lossy(bytes).replace('\0', "")
    }
}

/// spawn a local shell process and bridge it to tauri events.
/// returns (input_sender, start_signal) - the reader thread won't push output
/// until start_signal is sent, so the frontend has time to register its listener
pub fn spawn_local_shell(
    app: AppHandle,
    channel_id: String,
    shell_type: LocalShellType,
    cols: u16,
    rows: u16,
    cwd: Option<String>,
) -> Result<(mpsc::Sender<ChannelInput>, oneshot::Sender<()>), String> {
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
    let (start_tx, start_rx) = oneshot::channel::<()>();

    // reader thread: blocking IO from pty -> tauri events
    // waits for start signal so the frontend listener is ready before we push output
    let app_read = app.clone();
    let cid_read = channel_id.clone();
    std::thread::spawn(move || {
        // hold until the frontend says "i'm listening"
        let _ = start_rx.blocking_recv();

        let mut buf = [0u8; 4096];
        let mut utf8_pending = Vec::new();
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    if let Some(text) = decode_utf8_chunk(&mut utf8_pending, &buf[..n]) {
                        let _ = app_read.emit(&format!("terminal-output-{cid_read}"), text);
                    }
                }
                Err(e) => {
                    log::error!("pty read error: {e}");
                    break;
                }
            }
        }
        if let Some(text) = finish_utf8_chunk(&mut utf8_pending) {
            let _ = app_read.emit(&format!("terminal-output-{cid_read}"), text);
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

    Ok((tx, start_tx))
}

// local system stats via sysinfo

use sysinfo::{Disks, System};

/// local machine stats, same struct as remote ssh stats so the frontend
/// doesn't need to know which kind of tab it's looking at
pub fn fetch_local_system_stats(
    sys: &mut System,
    disks: &mut Disks,
) -> crate::commands::SystemStats {
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
    disks.refresh(true);
    let (disk_total_gb, disk_used_percent) = disks
        .iter()
        .find(|d| {
            // on windows, find C: drive
            d.mount_point()
                .to_str()
                .is_some_and(|p| p.starts_with("C:") || p == "/")
        })
        .or_else(|| disks.iter().next())
        .map(|d| {
            let total = d.total_space() as f64 / (1024.0 * 1024.0 * 1024.0);
            let used = (d.total_space() - d.available_space()) as f64 / (1024.0 * 1024.0 * 1024.0);
            let percent = if total > 0.0 {
                (used / total) * 100.0
            } else {
                0.0
            };
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
