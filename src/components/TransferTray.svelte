<script lang="ts">
  import { slide } from "svelte/transition";
  import { cubicOut } from "svelte/easing";
  import { transfers, type Transfer } from "../lib/transfers.svelte";
  import { humanSize } from "../lib/fileKind";

  let collapsed = $state(false);

  let items = $derived(transfers.items);
  let activeCount = $derived(items.filter((t) => t.status === "active").length);
  let hasFinished = $derived(items.some((t) => t.status !== "active"));

  // a fresh active transfer pops the tray back open if you'd collapsed it
  let lastActive = 0;
  $effect(() => {
    if (activeCount > lastActive) collapsed = false;
    lastActive = activeCount;
  });

  function pct(t: Transfer): number {
    if (t.total <= 0) return t.status === "done" ? 100 : 0;
    return Math.min(100, Math.round((t.transferred / t.total) * 100));
  }

  const dirGlyph = (d: "up" | "down") => (d === "up" ? "▲" : "▼");
</script>

{#if items.length > 0}
  <div class="tray" transition:slide={{ duration: 160, easing: cubicOut }}>
    <header class="tray-header">
      <button
        class="tray-toggle"
        onclick={() => (collapsed = !collapsed)}
        title={collapsed ? "Expand" : "Collapse"}
      >
        <span class="caret" class:up={!collapsed}>▸</span>
        <span class="tray-label">TRANSFERS</span>
        {#if activeCount > 0}
          <span class="badge">{activeCount} ACTIVE</span>
        {/if}
      </button>
      {#if hasFinished}
        <button class="tray-clear" onclick={() => transfers.clearFinished()}>CLEAR</button>
      {/if}
    </header>

    {#if !collapsed}
      <div class="tray-body" transition:slide={{ duration: 140, easing: cubicOut }}>
        {#each items as t (t.id)}
          <div class="xfer" class:err={t.status === "error"}>
            <span class="xfer-dir {t.direction}">{dirGlyph(t.direction)}</span>
            <div class="xfer-main">
              <div class="xfer-top">
                <span class="xfer-name" title={t.name}>{t.name}</span>
                <span class="xfer-meta">
                  {#if t.status === "active"}
                    {humanSize(t.transferred)}{#if t.total > 0} / {humanSize(t.total)}{/if}
                  {:else if t.status === "done"}
                    <span class="ok">done</span>
                  {:else if t.status === "cancelled"}
                    <span class="dim">cancelled</span>
                  {:else}
                    <span class="bad" title={t.error}>failed</span>
                  {/if}
                </span>
              </div>
              <div class="bar">
                <div
                  class="bar-fill {t.status}"
                  style="width: {t.status === 'done' ? 100 : pct(t)}%"
                ></div>
              </div>
            </div>
            {#if t.status === "active"}
              <button class="xfer-btn" onclick={() => transfers.cancel(t.id)} title="Cancel" aria-label="Cancel">✕</button>
            {:else}
              <button class="xfer-btn" onclick={() => transfers.dismiss(t.id)} title="Dismiss" aria-label="Dismiss">·</button>
            {/if}
          </div>
        {/each}
      </div>
    {/if}
  </div>
{/if}

<style>
  .tray {
    flex-shrink: 0;
    border-top: 1px solid var(--border-subtle);
    background: rgba(8, 8, 16, 0.55);
    max-height: 38vh;
    display: flex;
    flex-direction: column;
  }

  .tray-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.25rem 0.5rem 0.25rem 0.4rem;
    border-bottom: 1px solid var(--border-subtle);
    flex-shrink: 0;
  }

  .tray-toggle {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    background: none;
    border: none;
    cursor: pointer;
    padding: 0.15rem 0.25rem;
    color: var(--text-label);
    font-family: inherit;
  }

  .caret {
    font-size: 0.6rem;
    color: var(--text-dim);
    transition: transform var(--transition-fast);
  }

  .caret.up {
    transform: rotate(90deg);
  }

  .tray-label {
    font-size: 0.6rem;
    font-weight: 700;
    letter-spacing: 0.2em;
  }

  .badge {
    font-size: 0.55rem;
    font-weight: 700;
    letter-spacing: 0.12em;
    color: var(--accent-primary);
    border: 1px solid rgba(var(--accent-rgb), 0.4);
    padding: 0.05rem 0.3rem;
    background: rgba(var(--accent-rgb), 0.08);
  }

  .tray-clear {
    background: transparent;
    border: 1px solid var(--border-glow);
    color: var(--text-secondary);
    font-family: inherit;
    font-size: 0.55rem;
    font-weight: 600;
    letter-spacing: 0.12em;
    padding: 0.15rem 0.5rem;
    cursor: pointer;
    transition: all var(--transition-fast);
  }

  .tray-clear:hover {
    color: var(--accent-primary);
    border-color: var(--accent-primary);
    background: rgba(var(--accent-rgb), 0.06);
  }

  .tray-body {
    overflow-y: auto;
    padding: 0.3rem 0.5rem 0.4rem;
  }

  .xfer {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.3rem 0.2rem;
  }

  .xfer-dir {
    flex-shrink: 0;
    font-size: 0.6rem;
    width: 0.9em;
    text-align: center;
  }

  .xfer-dir.up {
    color: var(--accent-primary);
  }

  .xfer-dir.down {
    color: var(--accent-secondary);
  }

  .xfer-main {
    flex: 1;
    min-width: 0;
  }

  .xfer-top {
    display: flex;
    justify-content: space-between;
    gap: 0.5rem;
    margin-bottom: 0.2rem;
  }

  .xfer-name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 0.68rem;
    color: var(--text-secondary);
  }

  .xfer-meta {
    flex-shrink: 0;
    font-size: 0.58rem;
    color: var(--text-dim);
    font-variant-numeric: tabular-nums;
  }

  .xfer-meta .ok {
    color: var(--accent-primary);
  }

  .xfer-meta .bad {
    color: var(--accent-secondary);
  }

  .xfer-meta .dim {
    opacity: 0.6;
  }

  .bar {
    height: 3px;
    background: rgba(255, 255, 255, 0.07);
    overflow: hidden;
  }

  .bar-fill {
    height: 100%;
    background: rgba(var(--accent-rgb), 0.7);
    box-shadow: 0 0 6px rgba(var(--accent-rgb), 0.5);
    transition: width 0.18s ease-out;
  }

  .bar-fill.done {
    background: var(--accent-primary);
  }

  .bar-fill.error {
    background: var(--accent-secondary);
    box-shadow: 0 0 6px rgba(232, 37, 78, 0.5);
  }

  .bar-fill.cancelled {
    background: var(--text-dim);
    box-shadow: none;
  }

  .xfer-btn {
    flex-shrink: 0;
    display: grid;
    place-items: center;
    width: 18px;
    height: 18px;
    background: transparent;
    border: 1px solid transparent;
    color: var(--text-dim);
    font-size: 0.65rem;
    cursor: pointer;
    transition: all var(--transition-fast);
  }

  .xfer-btn:hover {
    color: var(--accent-secondary);
    border-color: rgba(232, 37, 78, 0.4);
  }

  .tray-body::-webkit-scrollbar {
    width: 6px;
  }

  .tray-body::-webkit-scrollbar-thumb {
    background: rgba(var(--accent-rgb), 0.3);
  }

  .tray-body::-webkit-scrollbar-track {
    background: transparent;
  }
</style>
