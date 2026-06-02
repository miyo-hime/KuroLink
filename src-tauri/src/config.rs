use base64::Engine;
use ring::aead;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::AppHandle;

const KEYCHAIN_SERVICE: &str = "kurolink";

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
    Password,
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
    // opt-in saved secrets. the secrets themselves live in the os keychain now;
    // these are just "is there one to go look for" flags.
    #[serde(default)]
    pub has_passphrase: bool,
    #[serde(default)]
    pub save_password: bool,
    // legacy: pre-0.17 aes-gcm ciphertext. only read once, to migrate into the
    // keychain, then nulled. never written again. delete this field once nobody's
    // config still carries one.
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
        Self {
            x: -1,
            y: -1,
            width: 1100,
            height: 950,
            maximized: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct AppConfig {
    pub profiles: Vec<ConnectionProfile>,
    pub last_profile_id: Option<String>,
    #[serde(default)]
    pub window_state: Option<WindowState>,
    #[serde(default)]
    pub ssh_debug: bool,
    // appearance is frontend-owned (preset id + palette overrides). rust never
    // reads inside it - it just round-trips the blob and lets the ui interpret.
    #[serde(default)]
    pub appearance: Option<serde_json::Value>,
    // last run's tab set, also frontend-owned. just intent (profiles, paths, shells) -
    // never the dead session/channel ids. the RESUME switch reads it, restore replays it.
    #[serde(default)]
    pub session: Option<serde_json::Value>,
}

pub fn config_path(_app: &AppHandle) -> Result<PathBuf, String> {
    let exe = std::env::current_exe().map_err(|e| format!("Failed to get exe path: {e}"))?;
    let dir = exe
        .parent()
        .ok_or_else(|| "Failed to get exe directory".to_string())?;
    Ok(dir.join("kurolink.json"))
}

pub fn load_config(app: &AppHandle) -> Result<AppConfig, String> {
    let path = config_path(app)?;
    if !path.exists() {
        return Ok(AppConfig::default());
    }
    let data = fs::read_to_string(&path).map_err(|e| format!("Failed to read config: {e}"))?;
    let mut config: AppConfig =
        serde_json::from_str(&data).map_err(|e| format!("Failed to parse config: {e}"))?;
    if migrate_legacy_passphrases(app, &mut config) {
        let _ = save_config(app, &config);
    }
    Ok(config)
}

// the secret store. service is constant, the account string namespaces what kind of
// secret it is per profile. on windows this is the credential manager (dpapi).

pub fn passphrase_account(profile_id: &str) -> String {
    format!("passphrase:{profile_id}")
}

pub fn password_account(profile_id: &str) -> String {
    format!("password:{profile_id}")
}

fn entry(account: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYCHAIN_SERVICE, account).map_err(|e| format!("keychain unavailable: {e}"))
}

pub fn keychain_set(account: &str, secret: &str) -> Result<(), String> {
    entry(account)?
        .set_password(secret)
        .map_err(|e| format!("keychain write failed: {e}"))
}

pub fn keychain_get(account: &str) -> Option<String> {
    entry(account).ok()?.get_password().ok()
}

pub fn keychain_delete(account: &str) -> Result<(), String> {
    match entry(account)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("keychain delete failed: {e}")),
    }
}

// everything below is the legacy passphrase reader. pre-0.17 we encrypted with an
// aes key derived from the config path - obfuscation, not real protection. this only
// exists to lift those old blobs into the keychain on first launch. don't write with it.

fn legacy_derive_key(app: &AppHandle) -> Result<aead::LessSafeKey, String> {
    let path = config_path(app)?;
    let seed = format!("kurolink-passphrase-key:{}", path.display());
    let digest = ring::digest::digest(&ring::digest::SHA256, seed.as_bytes());
    let unbound = aead::UnboundKey::new(&aead::AES_256_GCM, digest.as_ref())
        .map_err(|e| format!("key derivation failed: {e}"))?;
    Ok(aead::LessSafeKey::new(unbound))
}

fn legacy_decrypt(app: &AppHandle, encrypted: &str) -> Result<String, String> {
    let key = legacy_derive_key(app)?;
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
    String::from_utf8(plaintext.to_vec()).map_err(|e| format!("passphrase is not valid utf-8: {e}"))
}

// returns true if anything changed (so the caller knows to persist the cleaned config).
// only clears the old ciphertext once we've safely stashed it in the keychain - a dead
// blob we can't decrypt also gets cleared, since the key that made it is gone anyway.
fn migrate_legacy_passphrases(app: &AppHandle, config: &mut AppConfig) -> bool {
    let mut changed = false;
    for p in config.profiles.iter_mut() {
        let Some(enc) = p.saved_passphrase.clone() else {
            continue;
        };
        match legacy_decrypt(app, &enc) {
            Ok(plain) => {
                if keychain_set(&passphrase_account(&p.id), &plain).is_ok() {
                    p.saved_passphrase = None;
                    changed = true;
                }
            }
            Err(_) => {
                p.saved_passphrase = None;
                changed = true;
            }
        }
    }
    changed
}

pub fn save_config(app: &AppHandle, config: &AppConfig) -> Result<(), String> {
    let path = config_path(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed to create config dir: {e}"))?;
    }
    let data = serde_json::to_string_pretty(config)
        .map_err(|e| format!("Failed to serialize config: {e}"))?;
    fs::write(&path, data).map_err(|e| format!("Failed to write config: {e}"))
}
