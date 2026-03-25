use base64::Engine;
use ring::aead;
use ring::rand::{SecureRandom, SystemRandom};
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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "snake_case")]
pub enum AuthMode {
    KeyFile,
    #[default]
    Agent,
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
    // passphrase storage - opt-in, AES-256-GCM encrypted
    #[serde(default)]
    pub has_passphrase: bool,
    #[serde(default)]
    pub saved_passphrase: Option<String>,
    #[serde(default)]
    pub auth_mode: AuthMode,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WindowState {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub maximized: bool,
}

impl Default for WindowState {
    fn default() -> Self {
        Self { x: -1, y: -1, width: 1100, height: 950, maximized: false }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct AppConfig {
    pub profiles: Vec<ConnectionProfile>,
    pub last_profile_id: Option<String>,
    #[serde(default)]
    pub window_state: Option<WindowState>,
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

// passphrase encryption - AES-256-GCM with a machine-derived key.
// not a substitute for a proper keyring, but way better than plaintext.
// the key is derived from the config file path so it's tied to this install.

fn derive_key(app: &AppHandle) -> Result<aead::LessSafeKey, String> {
    let path = config_path(app)?;
    let seed = format!("kurolink-passphrase-key:{}", path.display());
    // hash the seed down to 32 bytes for AES-256
    let digest = ring::digest::digest(&ring::digest::SHA256, seed.as_bytes());
    let unbound = aead::UnboundKey::new(&aead::AES_256_GCM, digest.as_ref())
        .map_err(|e| format!("key derivation failed: {e}"))?;
    Ok(aead::LessSafeKey::new(unbound))
}

pub fn encrypt_passphrase(app: &AppHandle, plaintext: &str) -> Result<String, String> {
    let key = derive_key(app)?;
    let rng = SystemRandom::new();
    let mut nonce_bytes = [0u8; 12];
    rng.fill(&mut nonce_bytes).map_err(|e| format!("rng failed: {e}"))?;
    let nonce = aead::Nonce::assume_unique_for_key(nonce_bytes);

    let mut in_out = plaintext.as_bytes().to_vec();
    key.seal_in_place_append_tag(nonce, aead::Aad::empty(), &mut in_out)
        .map_err(|e| format!("encryption failed: {e}"))?;

    // prepend nonce to ciphertext
    let mut blob = nonce_bytes.to_vec();
    blob.extend_from_slice(&in_out);
    Ok(base64::engine::general_purpose::STANDARD.encode(&blob))
}

pub fn decrypt_passphrase(app: &AppHandle, encrypted: &str) -> Result<String, String> {
    let key = derive_key(app)?;
    let blob = base64::engine::general_purpose::STANDARD
        .decode(encrypted)
        .map_err(|e| format!("base64 decode failed: {e}"))?;

    if blob.len() < 12 {
        return Err("encrypted data too short".to_string());
    }
    let (nonce_bytes, ciphertext) = blob.split_at(12);
    let nonce = aead::Nonce::try_assume_unique_for_key(nonce_bytes)
        .map_err(|_| "invalid nonce".to_string())?;

    let mut in_out = ciphertext.to_vec();
    let plaintext = key
        .open_in_place(nonce, aead::Aad::empty(), &mut in_out)
        .map_err(|_| "decryption failed - wrong key or corrupted data".to_string())?;

    String::from_utf8(plaintext.to_vec())
        .map_err(|e| format!("passphrase is not valid utf-8: {e}"))
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
