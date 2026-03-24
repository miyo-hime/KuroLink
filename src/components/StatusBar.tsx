import type { SystemStats } from "../lib/types";
import "./StatusBar.css";

interface Props {
  stats: SystemStats | null;
  prevStats: SystemStats | null;
  pollIntervalMs: number;
}

function thresholdClass(value: number, cautionAt: number, criticalAt: number): string {
  if (value >= criticalAt) return "stat-value-critical";
  if (value >= cautionAt) return "stat-value-caution";
  return "stat-value-nominal";
}

export default function StatusBar({ stats, prevStats, pollIntervalMs }: Props) {
  if (!stats) {
    return (
      <div className="status-bar">
        <span className="stat-item stat-dim">Awaiting telemetry...</span>
      </div>
    );
  }

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
          <span className="stat-label">CPU</span>
          <span className={thresholdClass(stats.cpu_temp, 60, 75)}>
            {stats.cpu_temp.toFixed(0)}°C
          </span>
        </span>
      )}
      <span className="stat-item">
        <span className="stat-label">MEM</span>
        <span className={thresholdClass(stats.memory_used_percent, 70, 85)}>
          {stats.memory_used_percent.toFixed(0)}%
        </span>
        <span className="stat-unit">/ {stats.memory_total_mb}MB</span>
      </span>
      <span className="stat-item">
        <span className="stat-label">DISK</span>
        <span className={thresholdClass(stats.disk_used_percent, 80, 90)}>
          {stats.disk_used_percent.toFixed(0)}%
        </span>
        <span className="stat-unit">/ {stats.disk_total_gb.toFixed(1)}GB</span>
      </span>
      <span className="stat-item">
        <span className="stat-net-up">▲ {formatRate(txRate)}</span>
        <span className="stat-net-down">▼ {formatRate(rxRate)}</span>
      </span>
    </div>
  );
}

function formatRate(bytesPerSec: number): string {
  if (bytesPerSec < 1024) return `${bytesPerSec.toFixed(0)}B/s`;
  if (bytesPerSec < 1048576) return `${(bytesPerSec / 1024).toFixed(1)}KB/s`;
  return `${(bytesPerSec / 1048576).toFixed(1)}MB/s`;
}
