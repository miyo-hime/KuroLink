use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::AppHandle;

pub fn known_hosts_path() -> Result<PathBuf, String> {
    let home = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .map_err(|_| "Could not determine home directory".to_string())?;
    Ok(PathBuf::from(home).join(".ssh").join("known_hosts"))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionProfile {
    pub id: String,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub key_path: String,
    pub created_at: String,
    pub last_connected: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct AppConfig {
    pub profiles: Vec<ConnectionProfile>,
    pub last_profile_id: Option<String>,
}

pub fn config_path(_app: &AppHandle) -> Result<PathBuf, String> {
    let exe = std::env::current_exe()
        .map_err(|e| format!("Failed to get exe path: {e}"))?;
    let dir = exe.parent()
        .ok_or_else(|| "Failed to get exe directory".to_string())?;
    Ok(dir.join("kurolink.json"))
}

pub fn load_config(app: &AppHandle) -> Result<AppConfig, String> {
    let path = config_path(app)?;
    if !path.exists() {
        return Ok(AppConfig::default());
    }
    let data = fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read config: {e}"))?;
    serde_json::from_str(&data)
        .map_err(|e| format!("Failed to parse config: {e}"))
}

pub fn save_config(app: &AppHandle, config: &AppConfig) -> Result<(), String> {
    let path = config_path(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create config dir: {e}"))?;
    }
    let data = serde_json::to_string_pretty(config)
        .map_err(|e| format!("Failed to serialize config: {e}"))?;
    fs::write(&path, data)
        .map_err(|e| format!("Failed to write config: {e}"))
}
