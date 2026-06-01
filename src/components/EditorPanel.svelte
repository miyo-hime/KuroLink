<script lang="ts">
  import { untrack } from "svelte";
  import { sftpReadFile, sftpWriteFile } from "../lib/ipc";

  interface Props {
    channelId: string;
    sessionId: string;
    path: string;
    active: boolean;
    onDirtyChange: (channelId: string, dirty: boolean) => void;
  }

  let { channelId, sessionId, path, active, onDirtyChange }: Props = $props();

  let content = $state("");
  let saved = $state("");
  let loaded = $state(false);
  let loading = $state(true);
  let saving = $state(false);
  let error = $state<string | null>(null);
  let wrap = $state(true);

  // an unloaded file is never "dirty" even though content/saved both start ""
  let dirty = $derived(loaded && content !== saved);

  $effect(() => {
    const d = dirty;
    const id = channelId;
    // fire untracked - onDirtyChange writes MainView's `tabs`, and the `tabs` read
    // inside it would otherwise make this effect depend on tabs and loop forever
    untrack(() => onDirtyChange(id, d));
  });

  async function load() {
    loading = true;
    error = null;
    loaded = false;
    try {
      const text = await sftpReadFile(sessionId, path);
      content = text;
      saved = text;
      loaded = true;
    } catch (e) {
      error = String(e);
    } finally {
      loading = false;
    }
  }

  async function save() {
    if (saving || !loaded) return;
    saving = true;
    error = null;
    try {
      await sftpWriteFile(sessionId, path, content);
      saved = content;
    } catch (e) {
      error = String(e);
    } finally {
      saving = false;
    }
  }

  function onKeydown(e: KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      save();
    }
  }

  $effect(() => {
    path;
    sessionId;
    load();
  });
</script>

<div class="editor" class:hidden={!active}>
  <div class="editor-bar">
    <span class="editor-dot" class:dirty></span>
    <span class="editor-path" title={path}>{path}</span>
    <span class="editor-spacer"></span>
    {#if error && loaded}<span class="editor-err" title={error}>save failed</span>{/if}
    <button
      class="editor-btn {wrap ? 'on' : ''}"
      onclick={() => (wrap = !wrap)}
      title="Toggle line wrap"
    >
      WRAP
    </button>
    <button class="editor-btn" onclick={load} disabled={loading || saving} title="Reload from host">
      RELOAD
    </button>
    <button class="editor-btn save" onclick={save} disabled={!dirty || saving}>
      {saving ? "..." : "SAVE"}
    </button>
  </div>

  {#if loading}
    <div class="editor-state">READING {path}...</div>
  {:else if error && !loaded}
    <div class="editor-state err">{error}</div>
  {:else}
    <textarea
      class="editor-area"
      class:wrap
      bind:value={content}
      onkeydown={onKeydown}
      spellcheck="false"
      autocomplete="off"
      autocapitalize="off"
    ></textarea>
  {/if}
</div>

<style>
  .editor {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    background: rgba(10, 10, 20, 0.92);
  }

  .editor.hidden {
    display: none;
  }

  .editor-bar {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.35rem 0.6rem;
    border-bottom: 1px solid var(--border-subtle);
    background: rgba(8, 8, 16, 0.6);
    flex-shrink: 0;
  }

  .editor-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    flex-shrink: 0;
    background: var(--text-dim);
  }

  .editor-dot.dirty {
    background: var(--accent-warning);
    box-shadow: 0 0 5px var(--accent-warning);
  }

  .editor-path {
    font-size: 0.66rem;
    color: var(--text-secondary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    direction: rtl;
    text-align: left;
  }

  .editor-spacer {
    flex: 1;
  }

  .editor-err {
    font-size: 0.6rem;
    color: var(--accent-secondary);
    flex-shrink: 0;
  }

  .editor-btn {
    background: transparent;
    border: 1px solid var(--border-glow);
    color: var(--text-secondary);
    font-family: inherit;
    font-size: 0.6rem;
    font-weight: 600;
    letter-spacing: 0.08em;
    padding: 0.2rem 0.55rem;
    cursor: pointer;
    flex-shrink: 0;
    transition: all var(--transition-fast);
  }

  .editor-btn:disabled {
    opacity: 0.35;
    cursor: default;
  }

  .editor-btn:hover:not(:disabled) {
    color: var(--accent-primary);
    border-color: var(--accent-primary);
    background: rgba(var(--accent-rgb), 0.06);
  }

  .editor-btn.on {
    color: var(--accent-primary);
    border-color: var(--accent-primary);
    background: rgba(var(--accent-rgb), 0.1);
  }

  .editor-btn.save:hover:not(:disabled) {
    box-shadow: 0 0 8px rgba(var(--accent-rgb), 0.2);
  }

  .editor-area {
    flex: 1;
    min-height: 0;
    width: 100%;
    resize: none;
    border: none;
    outline: none;
    background: transparent;
    color: var(--text-primary);
    font-family: inherit;
    font-size: 0.8rem;
    line-height: 1.5;
    padding: 0.6rem 0.75rem;
    tab-size: 4;
    white-space: pre;
    overflow: auto;
  }

  .editor-area.wrap {
    white-space: pre-wrap;
    word-break: break-word;
  }

  .editor-state {
    flex: 1;
    display: grid;
    place-items: center;
    color: var(--accent-primary);
    font-size: 0.68rem;
    font-weight: 600;
    letter-spacing: 0.12em;
    padding: 1rem;
    text-align: center;
  }

  .editor-state.err {
    color: var(--accent-secondary);
    font-weight: 400;
    letter-spacing: 0;
    line-height: 1.5;
  }

  .editor-area::-webkit-scrollbar {
    width: 8px;
    height: 8px;
  }

  .editor-area::-webkit-scrollbar-thumb {
    background: rgba(var(--accent-rgb), 0.3);
  }

  .editor-area::-webkit-scrollbar-track {
    background: transparent;
  }
</style>
