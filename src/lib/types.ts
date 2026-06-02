export type AuthMode = "key_file" | "agent" | "password";

export interface ConnectionProfile {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  key_path: string;
  created_at: string;
  last_connected: string | null;
  has_passphrase: boolean;
  save_password: boolean;
  auth_mode: AuthMode;
}

export interface AgentIdentityInfo {
  key_type: string;
  fingerprint: string;
  comment: string;
}

export interface HostStatus {
  reachable: boolean;
  latency_ms: number | null;
  uptime: string | null;
  cpu_temp: number | null;
  memory_used: number | null;
  memory_total: string | null;
  disk_used: number | null;
  disk_total: string | null;
}

export interface SystemStats {
  cpu_temp: number | null;
  memory_used_percent: number;
  memory_total_mb: number;
  disk_used_percent: number;
  disk_total_gb: number;
  uptime: string;
  net_rx_bytes: number;
  net_tx_bytes: number;
  latency_ms: number;
}

export type LocalShellId = "powershell" | "cmd" | "wsl" | "nu";

export interface LocalShellInfo {
  id: LocalShellId;
  label: string;
  shortLabel: string;
  subtitle: string;
  detected: boolean;
  available: boolean;
}

export const DEFAULT_LOCAL_SHELLS: LocalShellInfo[] = [
  { id: "powershell", label: "PowerShell", shortLabel: "PS", subtitle: "POWERSHELL", detected: false, available: true },
  { id: "cmd", label: "Command Prompt", shortLabel: "CMD", subtitle: "PROMPT", detected: false, available: true },
  { id: "wsl", label: "WSL", shortLabel: "WSL", subtitle: "LINUX", detected: true, available: false },
  { id: "nu", label: "Nushell", shortLabel: "NU", subtitle: "NUSHELL", detected: true, available: false },
];

// tab backends - terminal IO doesn't care ssh vs local; editor is a non-PTY tab.
// editor carries profileId (baked at open) so it can be restored even after every
// shell tab on its session is gone - no sibling to derive the profile from later.
export type TabBackend =
  | { kind: "ssh"; sessionId: string; profileId: string; profileName: string }
  | { kind: "local"; shellType: LocalShellId }
  | { kind: "editor"; sessionId: string; profileId: string | null; path: string };

// what we stash for next launch - intent only, never the dead session/channel ids.
export type SavedTab =
  | { kind: "ssh"; profileId: string }
  | { kind: "local"; shellType: LocalShellId }
  | { kind: "editor"; profileId: string; path: string };

export interface SavedSession {
  tabs: SavedTab[];
  activeIndex: number;
}

export interface TerminalTab {
  // the tab's unique key. for ssh/local it's the real PTY channel; for editor
  // tabs it's a synthetic `editor:<uuid>` (no channel behind it).
  channelId: string;
  title: string;
  backend: TabBackend;
}

export interface SessionInfo {
  session_id: string;
  profile_id: string;
  profile_name: string;
  channel_count: number;
}

export interface OpenSshShellResult {
  channel_id: string;
  session_id: string;
}

export type ConnectionStatus = "connected" | "degraded" | "lost";

export interface SftpEntry {
  name: string;
  path: string;
  is_dir: boolean;
  is_symlink: boolean;
  size: number;
  modified: number | null;
}

// what a right-clicked tree row hands up to the browser's context menu.
// reloadList refreshes the list this entry lives in (delete/rename land here);
// reloadChildren refreshes the entry's OWN children (only dirs, for new-folder-inside).
export interface FileMenuTarget {
  entry: SftpEntry;
  reloadList: () => Promise<void>;
  reloadChildren?: () => Promise<void>;
}
