import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { ConnectionProfile, HostStatus, SystemStats } from "./types";

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

// -- Connection --

export const probeHost = (
  host: string,
  port: number,
  username: string,
  keyPath: string,
  passphrase?: string | null,
) => invoke<HostStatus>("probe_host", { host, port, username, keyPath, passphrase: passphrase ?? null });

export const connectSsh = (
  profileId: string,
  host: string,
  port: number,
  username: string,
  keyPath: string,
  passphrase?: string | null,
) =>
  invoke<string>("connect_ssh", {
    profileId,
    host,
    port,
    username,
    keyPath,
    passphrase: passphrase ?? null,
  });

export const disconnectSsh = (sessionId: string) =>
  invoke<void>("disconnect_ssh", { sessionId });

// -- Terminal --

export const openShell = (sessionId: string, cols: number, rows: number) =>
  invoke<string>("open_shell", { sessionId, cols, rows });

export const closeShell = (sessionId: string, channelId: string) =>
  invoke<void>("close_shell", { sessionId, channelId });

export const writeToShell = (
  sessionId: string,
  channelId: string,
  data: string,
) => invoke<void>("write_to_shell", { sessionId, channelId, data });

export const resizeShell = (
  sessionId: string,
  channelId: string,
  cols: number,
  rows: number,
) => invoke<void>("resize_shell", { sessionId, channelId, cols, rows });

export const pingSession = (sessionId: string) =>
  invoke<number>("ping_session", { sessionId });

export const fetchSystemStats = (sessionId: string) =>
  invoke<SystemStats>("fetch_system_stats", { sessionId });

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
