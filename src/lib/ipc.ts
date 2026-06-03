import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { ConnectionProfile, HostStatus, SystemStats, AgentIdentityInfo, OpenSshShellResult, SessionInfo, LocalShellInfo, LocalShellId, SftpEntry, SavedSession, Tab } from "./types";
import { normalizeSession } from "./savedSession";

// -- Config --

export const getProfiles = () => invoke<ConnectionProfile[]>("get_profiles");

export const saveProfile = (profile: ConnectionProfile) =>
  invoke<void>("save_profile", { profile });

export const deleteProfile = (profileId: string) =>
  invoke<void>("delete_profile", { profileId });

export const getLastProfile = () =>
  invoke<ConnectionProfile | null>("get_last_profile");

// -- Appearance --

export const getAppearance = () => invoke<unknown | null>("get_appearance");

export const saveAppearance = (appearance: unknown) =>
  invoke<void>("save_appearance", { appearance });

export const setWindowVibrancy = (mode: string) =>
  invoke<boolean>("set_window_vibrancy", { mode });

// -- Session restore --

// normalize at the boundary so every consumer sees the current tree shape, including
// legacy flat blobs from before split panes learned to persist
export const getSession = () => invoke<unknown>("get_session").then(normalizeSession);

export const saveSession = (session: SavedSession) =>
  invoke<void>("save_session", { session });

// -- Secrets (os keychain, keyed by profile + kind) --

export type SecretKind = "passphrase" | "password";

export const saveProfileSecret = (profileId: string, kind: SecretKind, secret: string) =>
  invoke<void>("save_profile_secret", { profileId, kind, secret });

export const getProfileSecret = (profileId: string, kind: SecretKind) =>
  invoke<string | null>("get_profile_secret", { profileId, kind });

export const clearProfileSecret = (profileId: string, kind: SecretKind) =>
  invoke<void>("clear_profile_secret", { profileId, kind });

// -- Agent --

export const detectAgent = () =>
  invoke<boolean>("detect_agent");

export const listAgentIdentities = () =>
  invoke<AgentIdentityInfo[]>("list_agent_identities");

// -- Connection --

export const probeHost = (
  host: string,
  port: number,
  username: string,
  keyPath: string,
  passphrase?: string | null,
  password?: string | null,
  authMode?: string | null,
) => invoke<HostStatus>("probe_host", { host, port, username, keyPath, passphrase: passphrase ?? null, password: password ?? null, authMode: authMode ?? null });

export const connectSsh = (
  profileId: string,
  host: string,
  port: number,
  username: string,
  keyPath: string,
  passphrase?: string | null,
  password?: string | null,
  authMode?: string | null,
) =>
  invoke<string>("connect_ssh", {
    profileId,
    host,
    port,
    username,
    keyPath,
    passphrase: passphrase ?? null,
    password: password ?? null,
    authMode: authMode ?? null,
  });

export const disconnectSsh = (sessionId: string) =>
  invoke<void>("disconnect_ssh", { sessionId });

// -- Terminal: shell open/close --

// open a shell on an existing ssh session (used by initial connection flow)
export const openShell = (sessionId: string, cols: number, rows: number) =>
  invoke<string>("open_shell", { sessionId, cols, rows });

// connect-or-reuse + open shell in one call (used by tab dropdown)
export const openSshShell = (profileId: string, cols: number, rows: number, passphrase?: string | null) =>
  invoke<OpenSshShellResult>("open_ssh_shell", { profileId, cols, rows, passphrase: passphrase ?? null });

// connect-or-reuse a session WITHOUT a shell - session restore uses this to back
// editor tabs whose host has no shell tab of its own
export const ensureSshSession = (profileId: string, passphrase?: string | null) =>
  invoke<string>("ensure_ssh_session", { profileId, passphrase: passphrase ?? null });

export const detectLocalShells = () =>
  invoke<LocalShellInfo[]>("detect_local_shells");

// spawn a local terminal
export const openLocalShell = (shellType: LocalShellId, cols: number, rows: number, cwd?: string | null) =>
  invoke<string>("open_local_shell", { shellType, cols, rows, cwd: cwd ?? null });

// -- Terminal: IO (backend-agnostic, just need channelId) --

export const channelReady = (channelId: string) =>
  invoke<void>("channel_ready", { channelId });

export const closeShell = (channelId: string) =>
  invoke<void>("close_shell", { channelId });

export const writeToShell = (channelId: string, data: string) =>
  invoke<void>("write_to_shell", { channelId, data });

export const resizeShell = (channelId: string, cols: number, rows: number) =>
  invoke<void>("resize_shell", { channelId, cols, rows });

// -- Session --

export const pingSession = (sessionId: string) =>
  invoke<number>("ping_session", { sessionId });

export const fetchSystemStats = (sessionId: string) =>
  invoke<SystemStats>("fetch_system_stats", { sessionId });

export const fetchLocalStats = () =>
  invoke<SystemStats>("fetch_local_stats");

export const getActiveSessions = () =>
  invoke<SessionInfo[]>("get_active_sessions");

export const getLaunchPath = () =>
  invoke<string | null>("get_launch_path");

// -- "Open KuroLink here" explorer integration (portable, HKCU, windows-only) --

export interface ContextMenuStatus {
  registered: boolean;
  stale: boolean;
}

export const contextMenuStatus = () =>
  invoke<ContextMenuStatus>("context_menu_status");

export const registerContextMenu = () =>
  invoke<void>("register_context_menu");

export const unregisterContextMenu = () =>
  invoke<void>("unregister_context_menu");

// -- Window tear-off --

// stash a live tab and spawn a window to adopt it. x/y/w/h are physical px.
export const tearOffTab = (layout: Tab, x: number, y: number, width: number, height: number) =>
  invoke<string>("tear_off_tab", { layout, x, y, width, height });

// a freshly-spawned window asks for the tab it was born to hold (null on main)
export const claimHandoff = () =>
  invoke<Tab | null>("claim_handoff");

// -- SFTP (rides the ssh session) --

export const sftpListDir = (sessionId: string, path: string) =>
  invoke<SftpEntry[]>("sftp_list_dir", { sessionId, path });

export const sftpRealpath = (sessionId: string, path: string) =>
  invoke<string>("sftp_realpath", { sessionId, path });

export const sftpReadFile = (sessionId: string, path: string) =>
  invoke<string>("sftp_read_file", { sessionId, path });

// the command returns a tauri Response, so this lands as an ArrayBuffer
export const sftpReadBytes = (sessionId: string, path: string) =>
  invoke<ArrayBuffer>("sftp_read_bytes", { sessionId, path });

export const sftpWriteFile = (sessionId: string, path: string, contents: string) =>
  invoke<void>("sftp_write_file", { sessionId, path, contents });

export const sftpCreateFile = (sessionId: string, path: string) =>
  invoke<void>("sftp_create_file", { sessionId, path });

export const sftpMkdir = (sessionId: string, path: string) =>
  invoke<void>("sftp_mkdir", { sessionId, path });

export const sftpRemove = (sessionId: string, path: string) =>
  invoke<void>("sftp_remove", { sessionId, path });

export const sftpRename = (sessionId: string, from: string, to: string) =>
  invoke<void>("sftp_rename", { sessionId, from, to });

// -- Transfers (streamed in rust, progress via the transfer-progress event) --

export const sftpDownload = (sessionId: string, remotePath: string, localPath: string, transferId: string) =>
  invoke<void>("sftp_download", { sessionId, remotePath, localPath, transferId });

export const sftpUpload = (sessionId: string, localPath: string, remotePath: string, transferId: string) =>
  invoke<void>("sftp_upload", { sessionId, localPath, remotePath, transferId });

// data is a Uint8Array - tauri v2 ships it over the efficient binary arg path
export const sftpUploadBytes = (sessionId: string, path: string, data: Uint8Array, transferId: string) =>
  invoke<void>("sftp_upload_bytes", { sessionId, path, data, transferId });

export const cancelTransfer = (transferId: string) =>
  invoke<void>("cancel_transfer", { transferId });

// -- Event Listeners --

export const onTerminalOutput = (
  channelId: string,
  cb: (data: string) => void,
): Promise<UnlistenFn> =>
  listen<string>(`terminal-output-${channelId}`, (e) => cb(e.payload));

export const onTerminalClosed = (
  channelId: string,
  cb: () => void,
): Promise<UnlistenFn> =>
  listen<void>(`terminal-closed-${channelId}`, () => cb());

export const onSessionError = (
  sessionId: string,
  cb: (msg: string) => void,
): Promise<UnlistenFn> =>
  listen<string>(`session-error-${sessionId}`, (e) => cb(e.payload));
