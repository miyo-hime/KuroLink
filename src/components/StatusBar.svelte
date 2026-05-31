<script lang="ts">
  import type { SystemStats } from "../lib/types";

  interface Props {
    stats: SystemStats | null;
    prevStats: SystemStats | null;
    pollIntervalMs: number;
  }

  let { stats, prevStats, pollIntervalMs }: Props = $props();

  function thresholdClass(value: number, cautionAt: number, criticalAt: number): string {
    if (value >= criticalAt) return "stat-value-critical";
    if (value >= cautionAt) return "stat-value-caution";
    return "stat-value-nominal";
  }

  function formatRate(bytesPerSec: number): string {
    if (bytesPerSec < 1024) return `${bytesPerSec.toFixed(0)}B/s`;
    if (bytesPerSec < 1048576) return `${(bytesPerSec / 1024).toFixed(1)}KB/s`;
    return `${(bytesPerSec / 1048576).toFixed(1)}MB/s`;
  }
</script>

{#if !stats}
  <div class="status-bar">
    <span class="stat-item stat-dim">Awaiting telemetry...</span>
  </div>
{:else}
  {@const rxRate = prevStats ? (stats.net_rx_bytes - prevStats.net_rx_bytes) / (pollIntervalMs / 1000) : 0}
  {@const txRate = prevStats ? (stats.net_tx_bytes - prevStats.net_tx_bytes) / (pollIntervalMs / 1000) : 0}
  <div class="status-bar">
    {#if stats.cpu_temp != null}
      <span class="stat-item">
        <span class="stat-label">CPU</span>
        <span class={thresholdClass(stats.cpu_temp, 60, 75)}>
          {stats.cpu_temp.toFixed(0)}°C
        </span>
      </span>
    {/if}
    <span class="stat-item">
      <span class="stat-label">MEM</span>
      <span class={thresholdClass(stats.memory_used_percent, 70, 85)}>
        {stats.memory_used_percent.toFixed(0)}%
      </span>
      <span class="stat-unit">/ {stats.memory_total_mb}MB</span>
    </span>
    <span class="stat-item">
      <span class="stat-label">DISK</span>
      <span class={thresholdClass(stats.disk_used_percent, 80, 90)}>
        {stats.disk_used_percent.toFixed(0)}%
      </span>
      <span class="stat-unit">/ {stats.disk_total_gb.toFixed(1)}GB</span>
    </span>
    <span class="stat-item">
      <span class="stat-net-up">▲ {formatRate(txRate)}</span>
      <span class="stat-net-down">▼ {formatRate(rxRate)}</span>
    </span>
  </div>
{/if}

<style>
  .status-bar {
    display: flex;
    align-items: center;
    gap: 0;
    padding: 0 0.75rem;
    height: 30px;
    background: var(--bg-secondary);
    border-top: 1px solid var(--border-subtle);
    flex-shrink: 0;
    overflow: hidden;
    position: relative;
  }

  /* glow border */
  .status-bar::before {
    content: "";
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 1px;
    background: linear-gradient(
      90deg,
      transparent,
      var(--border-glow) 20%,
      var(--accent-primary) 50%,
      var(--border-glow) 80%,
      transparent
    );
  }

  .stat-item {
    color: var(--text-dim);
    font-size: 0.65rem;
    font-variant-numeric: tabular-nums;
    letter-spacing: 0.03em;
    white-space: nowrap;
    display: flex;
    align-items: center;
    gap: 0.15rem;
    padding: 0 0.5rem;
  }

  .stat-item:not(:last-child) {
    border-right: 1px solid rgba(var(--accent-rgb), 0.08);
  }

  .stat-label {
    color: var(--text-label);
    font-weight: 600;
    margin-right: 0.2rem;
  }

  .stat-value-nominal { color: var(--accent-success); }
  .stat-value-caution { color: var(--accent-warning); }
  .stat-value-critical { color: var(--accent-secondary); }

  .stat-unit {
    color: var(--text-dim);
    opacity: 0.6;
  }

  .stat-net-up { color: var(--accent-primary); }
  .stat-net-down { color: var(--accent-tertiary); }

  .stat-dim {
    opacity: 0.5;
  }
</style>
