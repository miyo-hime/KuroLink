import type { SystemStats } from "../lib/types";
import "./StatusBar.css";

interface Props {
  stats: SystemStats | null;
  prevStats: SystemStats | null;
  pollIntervalMs: number;
}

export default function StatusBar({ stats, prevStats, pollIntervalMs }: Props) {
  if (!stats) {
    return (
      <div className="status-bar">
        <span className="stat-item stat-dim">Fetching stats...</span>
      </div>
    );
  }

  // Calculate network throughput from delta
  const rxRate = prevStats
    ? ((stats.net_rx_bytes - prevStats.net_rx_bytes) / (pollIntervalMs / 1000))
    : 0;
  const txRate = prevStats
    ? ((stats.net_tx_bytes - prevStats.net_tx_bytes) / (pollIntervalMs / 1000))
    : 0;

  return (
    <div className="status-bar">
      {stats.cpu_temp != null && (
        <span className="stat-item">
          CPU {stats.cpu_temp.toFixed(0)}°C
        </span>
      )}
      <span className="stat-item">
        MEM {stats.memory_used_percent.toFixed(0)}% / {stats.memory_total_mb}MB
      </span>
      <span className="stat-item">
        DISK {stats.disk_used_percent.toFixed(0)}% / {stats.disk_total_gb.toFixed(1)}GB
      </span>
      <span className="stat-item">
        ▲ {formatRate(txRate)} ▼ {formatRate(rxRate)}
      </span>
    </div>
  );
}

function formatRate(bytesPerSec: number): string {
  if (bytesPerSec < 1024) return `${bytesPerSec.toFixed(0)}B/s`;
  if (bytesPerSec < 1048576) return `${(bytesPerSec / 1024).toFixed(1)}KB/s`;
  return `${(bytesPerSec / 1048576).toFixed(1)}MB/s`;
}
