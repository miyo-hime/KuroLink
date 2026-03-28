import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { ConnectionProfile, HostStatus, SystemStats, AgentIdentityInfo, OpenSshShellResult, SessionInfo } from "./types";

// -- Config --

export const getProfiles = () => invoke<ConnectionProfile[]>("get_profiles");

export const saveProfile = (profile: ConnectionProfile) =>
  invoke<void>("save_profile", { profile });

export const deleteProfile = (profileId: string) =>
  invoke<void>("delete_profile", { profileId });

export const getLastProfile = () =>
  invoke<ConnectionProfile | null>("get_last_profile");

// -- Passphrase --

export const encryptPassphrase = (plaintext: string) =>
  invoke<string>("encrypt_profile_passphrase", { plaintext });

export const decryptPassphrase = (encrypted: string) =>
  invoke<string>("decrypt_profile_passphrase", { encrypted });

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
  authMode?: string | null,
) => invoke<HostStatus>("probe_host", { host, port, username, keyPath, passphrase: passphrase ?? null, authMode: authMode ?? null });

export const connectSsh = (
  profileId: string,
  host: string,
  port: number,
  username: string,
  keyPath: string,
  passphrase?: string | null,
  authMode?: string | null,
) =>
  invoke<string>("connect_ssh", {
    profileId,
    host,
    port,
    username,
    keyPath,
    passphrase: passphrase ?? null,
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

// spawn a local terminal (powershell, cmd, wsl)
export const openLocalShell = (shellType: string, cols: number, rows: number, cwd?: string | null) =>
  invoke<string>("open_local_shell", { shellType, cols, rows, cwd: cwd ?? null });

// -- Terminal: IO (backend-agnostic, just need channelId) --

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
