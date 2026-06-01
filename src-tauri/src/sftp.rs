use russh_sftp::client::SftpSession;
use russh_sftp::protocol::OpenFlags;
use serde::Serialize;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::time::timeout;

// 64KB chunks for streamed transfers - big enough to keep the pipe busy, small
// enough that cancel + progress react quickly
const XFER_CHUNK: usize = 64 * 1024;

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

// transfers stream chunk-by-chunk and skip the file-op timeout on purpose: a real
// transfer over a poky link can run for minutes, so the cancel flag is the escape
// hatch instead of a wall-clock ceiling. progress(done, total) fires per chunk; the
// caller throttles the actual emit.

pub async fn download(
    sftp: &SftpSession,
    remote: &str,
    local: &Path,
    cancel: &AtomicBool,
    mut progress: impl FnMut(u64, u64),
) -> Result<(), String> {
    let total = sftp
        .metadata(remote)
        .await
        .map_err(|e| format!("stat failed: {e}"))?
        .size
        .unwrap_or(0);
    let mut src = sftp
        .open(remote)
        .await
        .map_err(|e| format!("open failed: {e}"))?;
    let mut dst = tokio::fs::File::create(local)
        .await
        .map_err(|e| format!("local create failed: {e}"))?;

    let mut buf = vec![0u8; XFER_CHUNK];
    let mut done: u64 = 0;
    progress(0, total);
    loop {
        if cancel.load(Ordering::Relaxed) {
            drop(dst);
            let _ = tokio::fs::remove_file(local).await;
            return Err("transfer cancelled".to_string());
        }
        let n = src
            .read(&mut buf)
            .await
            .map_err(|e| format!("read failed: {e}"))?;
        if n == 0 {
            break;
        }
        dst.write_all(&buf[..n])
            .await
            .map_err(|e| format!("local write failed: {e}"))?;
        done += n as u64;
        progress(done, total.max(done));
    }
    dst.flush()
        .await
        .map_err(|e| format!("flush failed: {e}"))?;
    progress(done, done);
    Ok(())
}

pub async fn upload(
    sftp: &SftpSession,
    local: &Path,
    remote: &str,
    cancel: &AtomicBool,
    mut progress: impl FnMut(u64, u64),
) -> Result<(), String> {
    let total = tokio::fs::metadata(local)
        .await
        .map_err(|e| format!("local stat failed: {e}"))?
        .len();
    let mut src = tokio::fs::File::open(local)
        .await
        .map_err(|e| format!("local open failed: {e}"))?;
    let mut dst = sftp
        .open_with_flags(
            remote,
            OpenFlags::CREATE | OpenFlags::WRITE | OpenFlags::TRUNCATE,
        )
        .await
        .map_err(|e| format!("open failed: {e}"))?;

    let mut buf = vec![0u8; XFER_CHUNK];
    let mut done: u64 = 0;
    progress(0, total);
    loop {
        if cancel.load(Ordering::Relaxed) {
            drop(dst);
            let _ = sftp.remove_file(remote).await;
            return Err("transfer cancelled".to_string());
        }
        let n = src
            .read(&mut buf)
            .await
            .map_err(|e| format!("local read failed: {e}"))?;
        if n == 0 {
            break;
        }
        dst.write_all(&buf[..n])
            .await
            .map_err(|e| format!("write failed: {e}"))?;
        done += n as u64;
        progress(done, total.max(done));
    }
    dst.flush()
        .await
        .map_err(|e| format!("flush failed: {e}"))?;
    progress(done, done);
    Ok(())
}

// the drag-drop path: js already holds the dropped file's bytes (no local path to
// hand us, webview security), so we write them straight through. capped only by the
// browser holding the whole File in memory first - fine for the convenience case.
pub async fn write_bytes(
    sftp: &SftpSession,
    path: &str,
    data: &[u8],
    cancel: &AtomicBool,
    mut progress: impl FnMut(u64, u64),
) -> Result<(), String> {
    let total = data.len() as u64;
    let mut dst = sftp
        .open_with_flags(
            path,
            OpenFlags::CREATE | OpenFlags::WRITE | OpenFlags::TRUNCATE,
        )
        .await
        .map_err(|e| format!("open failed: {e}"))?;

    let mut done: u64 = 0;
    progress(0, total);
    for chunk in data.chunks(XFER_CHUNK) {
        if cancel.load(Ordering::Relaxed) {
            drop(dst);
            let _ = sftp.remove_file(path).await;
            return Err("transfer cancelled".to_string());
        }
        dst.write_all(chunk)
            .await
            .map_err(|e| format!("write failed: {e}"))?;
        done += chunk.len() as u64;
        progress(done, total);
    }
    dst.flush()
        .await
        .map_err(|e| format!("flush failed: {e}"))?;
    Ok(())
}
