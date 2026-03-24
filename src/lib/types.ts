export interface ConnectionProfile {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  key_path: string;
  created_at: string;
  last_connected: string | null;
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
}

export interface TerminalTab {
  channelId: string;
  title: string;
}

export type ConnectionStatus = "connected" | "degraded" | "lost";
export type MainMode = "cli" | "de";
