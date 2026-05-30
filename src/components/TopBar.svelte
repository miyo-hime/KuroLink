<script lang="ts">
  import type { ConnectionStatus } from "../lib/types";
  import WindowControls from "./WindowControls.svelte";
  import KuroLinkMark from "./KuroLinkMark.svelte";

  interface Props {
    hostname: string;
    connectionStatus: ConnectionStatus;
    latency: number | null;
    searchActive: boolean;
    onSearchToggle: () => void;
    onDisconnect: () => void;
  }

  let {
    hostname,
    connectionStatus,
    latency,
    searchActive,
    onSearchToggle,
    onDisconnect,
  }: Props = $props();

  function latencyClass(ms: number): string {
    if (ms < 50) return "latency-good";
    if (ms < 150) return "latency-warn";
    return "latency-bad";
  }

  function statusIndicator(status: ConnectionStatus) {
    switch (status) {
      case "connected":
        return { className: "indicator-green indicator-pulse", label: "connected" };
      case "degraded":
        return { className: "indicator-warning indicator-pulse", label: "unstable" };
      case "lost":
        return { className: "indicator-red", label: "link lost" };
    }
  }

  let indicator = $derived(statusIndicator(connectionStatus));
  let confirming = $state(false);

  $effect(() => {
    if (!confirming) return;
    const timer = setTimeout(() => (confirming = false), 5000);
    return () => clearTimeout(timer);
  });
</script>

<div class="top-bar" data-tauri-drag-region>
  <div class="top-bar-left" data-tauri-drag-region>
    <span class="top-bar-mark" data-tauri-drag-region><KuroLinkMark /></span>
    <span class="top-bar-label" data-tauri-drag-region>TARGET</span>
    <span class="top-bar-host" data-tauri-drag-region>{hostname}</span>
    <span class="indicator-diamond {indicator.className}"></span>
    <span class="top-bar-status {connectionStatus !== 'connected' ? 'status-warn' : ''}" data-tauri-drag-region>
      {indicator.label}
    </span>
    {#if latency != null && connectionStatus === "connected"}
      <span class="top-bar-latency {latencyClass(latency)}" data-tauri-drag-region>{latency}ms</span>
    {/if}
  </div>
  <div class="top-bar-right">
    <div class="top-bar-actions">
      <button
        class="mode-btn {searchActive ? 'mode-active' : ''}"
        onclick={onSearchToggle}
        title="Search terminal (Ctrl+Shift+F)"
      >
        FIND
      </button>
      {#if confirming}
        <div class="disconnect-confirm">
          <span class="disconnect-confirm-label">TERMINATE LINK?</span>
          <button
            class="disconnect-confirm-btn confirm-yes"
            onclick={() => { confirming = false; onDisconnect(); }}
          >
            YES
          </button>
          <button
            class="disconnect-confirm-btn confirm-no"
            onclick={() => (confirming = false)}
          >
            NO
          </button>
        </div>
      {:else}
        <button
          class="disconnect-btn"
          onclick={() => (confirming = true)}
          aria-label="Terminate link"
          title="Terminate link"
        >
          <svg class="disconnect-glyph" viewBox="0 0 10 10" aria-hidden="true">
            <polygon points="5,1.2 8.8,6 1.2,6" />
            <rect x="1.2" y="7.4" width="7.6" height="1.4" />
          </svg>
        </button>
      {/if}
    </div>
    <span class="top-bar-divider"></span>
    <WindowControls />
  </div>
</div>

<style>
  .top-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 0 0 0.75rem;
    height: 40px;
    background: var(--bg-secondary);
    background-image:
      repeating-linear-gradient(0deg, var(--hud-grid) 0 1px, transparent 1px 20px),
      repeating-linear-gradient(90deg, var(--hud-grid) 0 1px, transparent 1px 20px);
    border-bottom: 1px solid var(--border-subtle);
    flex-shrink: 0;
    position: relative;
    overflow: hidden;
  }

  /* glow border */
  .top-bar::after {
    content: "";
    position: absolute;
    bottom: 0;
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

  /* scan line thing */
  .top-bar::before {
    content: "";
    position: absolute;
    left: 0;
    right: 0;
    height: 1px;
    background: linear-gradient(
      90deg,
      transparent,
      rgba(0, 212, 255, 0.08),
      transparent
    );
    animation: scan-line 8s linear infinite;
    pointer-events: none;
    will-change: transform;
  }

  .top-bar-left {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    height: 100%;
  }

  .top-bar-mark {
    display: flex;
    align-items: center;
    flex-shrink: 0;
    margin-right: 0.15rem;
  }

  .top-bar-label {
    color: var(--text-label);
    font-size: 0.55rem;
    font-weight: 600;
    letter-spacing: 0.15em;
    text-transform: uppercase;
  }

  .top-bar-host {
    color: var(--text-primary);
    font-size: 0.8rem;
    font-weight: 600;
  }

  .top-bar-status {
    color: var(--text-dim);
    font-size: 0.7rem;
  }

  .top-bar-status.status-warn {
    color: var(--accent-warning);
    font-weight: 600;
    letter-spacing: 0.05em;
    text-transform: uppercase;
  }

  .top-bar-latency {
    font-size: 0.7rem;
    font-variant-numeric: tabular-nums;
    transition: color var(--transition-fast);
  }

  .latency-good { color: var(--accent-success); }
  .latency-warn { color: var(--accent-warning); }
  .latency-bad { color: var(--accent-secondary); }

  .top-bar-right {
    display: flex;
    align-items: stretch;
    height: 100%;
  }

  .top-bar-actions {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }

  .top-bar-divider {
    width: 1px;
    height: 18px;
    align-self: center;
    background: var(--border-glow);
    margin: 0 0.5rem;
  }

  .mode-btn {
    padding: 0.2rem 0.6rem;
    font-family: inherit;
    font-size: 0.65rem;
    font-weight: 600;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    border: 1px solid var(--border-glow);
    color: var(--text-secondary);
    cursor: pointer;
    transition: all var(--transition-fast);
    background: transparent;
    clip-path: polygon(
      0 0,
      calc(100% - 5px) 0,
      100% 5px,
      100% 100%,
      5px 100%,
      0 calc(100% - 5px)
    );
  }

  .mode-btn:hover:not(:disabled) {
    color: var(--accent-primary);
    border-color: var(--accent-primary);
    background: rgba(0, 212, 255, 0.04);
  }

  .mode-active {
    color: var(--accent-primary);
    border-color: var(--accent-primary);
    background: rgba(0, 212, 255, 0.08);
    border-top: 2px solid var(--accent-primary);
  }

  .disconnect-btn {
    display: inline-grid;
    place-items: center;
    background: none;
    border: 1px solid rgba(232, 37, 78, 0.3);
    color: var(--accent-secondary);
    padding: 0.3rem 0.5rem;
    cursor: pointer;
    transition: all var(--transition-fast);
    margin-left: 0.5rem;
    clip-path: polygon(
      0 0,
      calc(100% - 4px) 0,
      100% 4px,
      100% 100%,
      4px 100%,
      0 calc(100% - 4px)
    );
  }

  .disconnect-glyph {
    width: 11px;
    height: 11px;
    display: block;
    fill: currentColor;
  }

  .disconnect-btn:hover {
    background: rgba(232, 37, 78, 0.12);
    border-color: var(--accent-secondary);
    box-shadow: var(--glow-sm) rgba(232, 37, 78, 0.25);
  }

  /* ---- disconnect confirm ---- */

  .disconnect-confirm {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    margin-left: 0.5rem;
    animation: fade-in 0.15s ease-out;
  }

  .disconnect-confirm-label {
    color: var(--accent-secondary);
    font-size: 0.6rem;
    font-weight: 600;
    letter-spacing: 0.1em;
    margin-right: 0.2rem;
  }

  .disconnect-confirm-btn {
    background: transparent;
    border: 1px solid;
    font-family: inherit;
    font-size: 0.6rem;
    font-weight: 600;
    letter-spacing: 0.05em;
    padding: 0.15rem 0.5rem;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .confirm-yes {
    color: var(--accent-secondary);
    border-color: rgba(232, 37, 78, 0.4);
  }

  .confirm-yes:hover {
    background: rgba(232, 37, 78, 0.12);
    border-color: var(--accent-secondary);
  }

  .confirm-no {
    color: var(--text-dim);
    border-color: rgba(74, 74, 100, 0.3);
  }

  .confirm-no:hover {
    color: var(--accent-primary);
    border-color: var(--accent-primary);
  }

  @keyframes fade-in {
    from { opacity: 0; }
    to { opacity: 1; }
  }
</style>
