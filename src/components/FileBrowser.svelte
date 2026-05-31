<script lang="ts">
  import type { SftpEntry } from "../lib/types";
  import { sftpListDir, sftpRealpath } from "../lib/ipc";
  import FileTreeNode from "./FileTreeNode.svelte";

  interface Props {
    sessionId: string;
    onClose: () => void;
  }

  let { sessionId, onClose }: Props = $props();

  let home = $state("");
  let root = $state<SftpEntry[] | null>(null);
  let loading = $state(false);
  let error = $state<string | null>(null);

  async function load() {
    loading = true;
    error = null;
    root = null;
    try {
      home = await sftpRealpath(sessionId, ".");
      root = await sftpListDir(sessionId, home);
    } catch (e) {
      error = String(e);
    } finally {
      loading = false;
    }
  }

  // reload whenever we point at a different session
  $effect(() => {
    sessionId;
    load();
  });
</script>

<aside class="file-browser">
  <header class="fb-header">
    <span class="fb-title">FILES</span>
    <div class="fb-actions">
      <button class="fb-btn" onclick={load} title="Refresh" aria-label="Refresh">⟳</button>
      <button class="fb-btn" onclick={onClose} title="Close" aria-label="Close">✕</button>
    </div>
  </header>

  {#if home}
    <div class="fb-path" title={home}>{home}</div>
  {/if}

  <div class="fb-body">
    {#if loading}
      <div class="fb-state">MOUNTING FS...</div>
    {:else if error}
      <div class="fb-state err">{error}</div>
    {:else if root}
      {#each root as entry (entry.path)}
        <FileTreeNode {entry} {sessionId} depth={0} />
      {/each}
      {#if root.length === 0}
        <div class="fb-state dim">empty directory</div>
      {/if}
    {/if}
  </div>
</aside>

<style>
  .file-browser {
    display: flex;
    flex-direction: column;
    width: 250px;
    flex-shrink: 0;
    height: 100%;
    border-right: 1px solid var(--border-subtle);
    background: rgba(8, 8, 16, 0.4);
    position: relative;
  }

  .file-browser::after {
    content: "";
    position: absolute;
    top: 0;
    bottom: 0;
    right: 0;
    width: 1px;
    background: linear-gradient(
      180deg,
      transparent,
      var(--border-glow) 20%,
      rgba(var(--accent-rgb), 0.5) 50%,
      var(--border-glow) 80%,
      transparent
    );
  }

  .fb-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.4rem 0.5rem 0.4rem 0.7rem;
    border-bottom: 1px solid var(--border-subtle);
    flex-shrink: 0;
  }

  .fb-title {
    color: var(--text-label);
    font-size: 0.6rem;
    font-weight: 700;
    letter-spacing: 0.2em;
  }

  .fb-actions {
    display: flex;
    gap: 0.2rem;
  }

  .fb-btn {
    display: grid;
    place-items: center;
    width: 20px;
    height: 20px;
    background: transparent;
    border: 1px solid var(--border-glow);
    color: var(--text-secondary);
    font-size: 0.7rem;
    cursor: pointer;
    transition: all var(--transition-fast);
  }

  .fb-btn:hover {
    color: var(--accent-primary);
    border-color: var(--accent-primary);
    background: rgba(var(--accent-rgb), 0.06);
  }

  .fb-path {
    padding: 0.3rem 0.7rem;
    font-size: 0.62rem;
    color: var(--text-dim);
    border-bottom: 1px solid var(--border-subtle);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    direction: rtl;
    text-align: left;
    flex-shrink: 0;
  }

  .fb-body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overflow-x: hidden;
    padding: 0.3rem 0;
  }

  .fb-state {
    padding: 0.6rem 0.7rem;
    font-size: 0.65rem;
    letter-spacing: 0.1em;
    color: var(--accent-primary);
    font-weight: 600;
  }

  .fb-state.err {
    color: var(--accent-secondary);
    font-weight: 400;
    letter-spacing: 0;
    line-height: 1.4;
  }

  .fb-state.dim {
    color: var(--text-dim);
    font-weight: 400;
    font-style: italic;
    letter-spacing: 0;
  }

  .fb-body::-webkit-scrollbar {
    width: 6px;
  }

  .fb-body::-webkit-scrollbar-thumb {
    background: rgba(var(--accent-rgb), 0.3);
  }

  .fb-body::-webkit-scrollbar-track {
    background: transparent;
  }
</style>
