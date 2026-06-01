use russh_sftp::client::SftpSession;
use russh_sftp::protocol::OpenFlags;
use serde::Serialize;
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::time::timeout;

// cap the read so a giant file - or an endless one like a fifo or a live log - can't
// wedge the whole app. codemirror is viewport-virtualized so the editor render isn't
// the ceiling anymore; this is now a transport guard. 50MB covers ~every config, script,
// log, and reasonable image. images and text share the cap - one number, easy to reason about.
const MAX_FILE_BYTES: u64 = 50 * 1024 * 1024;
// hard ceiling so a dead reply task can never leave the frontend spinning forever.
// 60s because 50MB over a poky link shouldn't false-fail - it's a ceiling, not a delay.
const FILE_OP_TIMEOUT: Duration = Duration::from_secs(60);

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

async fn read_capped(sftp: &SftpSession, path: &str) -> Result<Vec<u8>, String> {
    let read = async {
        let file = sftp
            .open(path)
            .await
            .map_err(|e| format!("open failed: {e}"))?;
        let mut buf = Vec::new();
        file.take(MAX_FILE_BYTES + 1)
            .read_to_end(&mut buf)
            .await
            .map_err(|e| format!("read failed: {e}"))?;
        Ok::<_, String>(buf)
    };

    let buf = timeout(FILE_OP_TIMEOUT, read)
        .await
        .map_err(|_| "read timed out - the host didn't answer in time".to_string())??;

    if buf.len() as u64 > MAX_FILE_BYTES {
        return Err(format!(
            "file is over {} MB - too big to open",
            MAX_FILE_BYTES / (1024 * 1024)
        ));
    }

    Ok(buf)
}

pub async fn read_file(sftp: &SftpSession, path: &str) -> Result<String, String> {
    let buf = read_capped(sftp, path).await?;
    Ok(String::from_utf8_lossy(&buf).to_string())
}

// the bytes path images ride on - no utf-8 round-trip to mangle them. it's also the
// foundation the transfer-queue slice's download will reuse.
pub async fn read_bytes(sftp: &SftpSession, path: &str) -> Result<Vec<u8>, String> {
    read_capped(sftp, path).await
}

pub async fn write_file(sftp: &SftpSession, path: &str, contents: String) -> Result<(), String> {
    // russh-sftp's write() convenience opens WRITE-only: no CREATE (can't make new
    // files) and no TRUNCATE (a shorter save leaves the old tail as garbage). open
    // it ourselves with both so saves are honest.
    let write = async {
        let mut file = sftp
            .open_with_flags(
                path,
                OpenFlags::CREATE | OpenFlags::WRITE | OpenFlags::TRUNCATE,
            )
            .await
            .map_err(|e| format!("open failed: {e}"))?;
        file.write_all(contents.as_bytes())
            .await
            .map_err(|e| format!("write failed: {e}"))?;
        file.flush()
            .await
            .map_err(|e| format!("flush failed: {e}"))?;
        Ok::<_, String>(())
    };
    timeout(FILE_OP_TIMEOUT, write)
        .await
        .map_err(|_| "write timed out - the host didn't answer in time".to_string())?
}

pub async fn create_file(sftp: &SftpSession, path: &str) -> Result<(), String> {
    // CREATE|EXCLUDE makes the server refuse if the path already exists, so a new
    // file never silently clobbers something. the handle closes on drop.
    sftp.open_with_flags(
        path,
        OpenFlags::CREATE | OpenFlags::WRITE | OpenFlags::EXCLUDE,
    )
    .await
    .map(|_| ())
    .map_err(|e| format!("create failed: {e}"))
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
