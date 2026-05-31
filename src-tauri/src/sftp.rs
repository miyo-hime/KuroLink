use russh_sftp::client::SftpSession;
use serde::Serialize;

#[derive(Serialize, Clone)]
pub struct SftpEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub is_symlink: bool,
    pub size: u64,
    pub modified: Option<u64>,
}

fn join_path(dir: &str, name: &str) -> String {
    if dir.ends_with('/') {
        format!("{dir}{name}")
    } else {
        format!("{dir}/{name}")
    }
}

pub async fn list_dir(sftp: &SftpSession, path: &str) -> Result<Vec<SftpEntry>, String> {
    let read = sftp
        .read_dir(path)
        .await
        .map_err(|e| format!("read_dir failed: {e}"))?;

    let mut entries = Vec::new();
    for entry in read {
        let name = entry.file_name();
        if name == "." || name == ".." {
            continue;
        }
        let meta = entry.metadata();
        entries.push(SftpEntry {
            path: join_path(path, &name),
            name,
            is_dir: meta.is_dir(),
            is_symlink: meta.is_symlink(),
            size: meta.size.unwrap_or(0),
            modified: meta.mtime.map(|m| m as u64),
        });
    }

    // dirs first, then alpha - so the tree reads like a file manager, not a syscall
    entries.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });

    Ok(entries)
}

pub async fn realpath(sftp: &SftpSession, path: &str) -> Result<String, String> {
    sftp.canonicalize(path)
        .await
        .map_err(|e| format!("canonicalize failed: {e}"))
}

pub async fn read_file(sftp: &SftpSession, path: &str) -> Result<String, String> {
    let bytes = sftp
        .read(path)
        .await
        .map_err(|e| format!("read failed: {e}"))?;
    Ok(String::from_utf8_lossy(&bytes).to_string())
}

pub async fn write_file(sftp: &SftpSession, path: &str, contents: String) -> Result<(), String> {
    sftp.write(path, contents.as_bytes())
        .await
        .map_err(|e| format!("write failed: {e}"))
}

pub async fn make_dir(sftp: &SftpSession, path: &str) -> Result<(), String> {
    sftp.create_dir(path)
        .await
        .map_err(|e| format!("mkdir failed: {e}"))
}

pub async fn remove(sftp: &SftpSession, path: &str) -> Result<(), String> {
    let meta = sftp
        .metadata(path)
        .await
        .map_err(|e| format!("stat failed: {e}"))?;
    if meta.is_dir() {
        sftp.remove_dir(path)
            .await
            .map_err(|e| format!("rmdir failed: {e}"))
    } else {
        sftp.remove_file(path)
            .await
            .map_err(|e| format!("rm failed: {e}"))
    }
}

pub async fn rename(sftp: &SftpSession, from: &str, to: &str) -> Result<(), String> {
    sftp.rename(from, to)
        .await
        .map_err(|e| format!("rename failed: {e}"))
}
