<script lang="ts">
  import type { SftpEntry, FileMenuTarget } from "../lib/types";
  import { sftpListDir } from "../lib/ipc";
  import Self from "./FileTreeNode.svelte";

  interface Props {
    entry: SftpEntry;
    sessionId: string;
    depth: number;
    reloadList: () => Promise<void>;
    onContextMenu: (e: MouseEvent, target: FileMenuTarget) => void;
    onOpenFile: (sessionId: string, path: string) => void;
  }

  let { entry, sessionId, depth, reloadList, onContextMenu, onOpenFile }: Props = $props();

  let expanded = $state(false);
  let children = $state<SftpEntry[] | null>(null);
  let loading = $state(false);
  let error = $state<string | null>(null);

  function onRowClick() {
    if (entry.is_dir) {
      toggle();
    } else {
      onOpenFile(sessionId, entry.path);
    }
  }

  async function toggle() {
    if (!entry.is_dir) return;
    if (children === null) {
      loading = true;
      error = null;
      try {
        children = await sftpListDir(sessionId, entry.path);
      } catch (e) {
        error = String(e);
        loading = false;
        return;
      }
      loading = false;
    }
    expanded = !expanded;
  }

  // re-list only if we've already opened this dir (delete/rename of a child lands here)
  async function reloadChildren() {
    if (children !== null) {
      children = await sftpListDir(sessionId, entry.path);
    }
  }

  // load + force open - used after dropping a new folder inside a collapsed dir
  async function expandReload() {
    children = await sftpListDir(sessionId, entry.path);
    expanded = true;
  }

  function rowContextMenu(e: MouseEvent) {
    onContextMenu(e, {
      entry,
      reloadList,
      reloadChildren: entry.is_dir ? expandReload : undefined,
    });
  }
</script>

<div class="node">
  <button
    class="row {entry.is_dir ? 'is-dir' : 'is-file'}"
    style="padding-left: {depth * 14 + 8}px"
    onclick={onRowClick}
    oncontextmenu={rowContextMenu}
    title={entry.path}
  >
    {#if entry.is_dir}
      <span class="twisty" class:open={expanded}>▸</span>
    {:else}
      <span class="twisty spacer"></span>
    {/if}
    <span class="glyph">{entry.is_dir ? "▣" : "·"}</span>
    <span class="name">{entry.name}</span>
    {#if entry.is_symlink}<span class="link-mark">→</span>{/if}
  </button>

  {#if loading}
    <div class="hint" style="padding-left: {(depth + 1) * 14 + 8}px">scanning...</div>
  {/if}
  {#if error}
    <div class="hint err" style="padding-left: {(depth + 1) * 14 + 8}px" title={error}>access denied</div>
  {/if}

  {#if expanded && children}
    {#if children.length === 0}
      <div class="hint dim" style="padding-left: {(depth + 1) * 14 + 8}px">empty</div>
    {:else}
      {#each children as child (child.path)}
        <Self
          entry={child}
          {sessionId}
          depth={depth + 1}
          reloadList={reloadChildren}
          {onContextMenu}
          {onOpenFile}
        />
      {/each}
    {/if}
  {/if}
</div>

<style>
  .node {
    display: flex;
    flex-direction: column;
  }

  .row {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    width: 100%;
    padding: 0.18rem 0.5rem 0.18rem 0;
    background: transparent;
    border: none;
    cursor: pointer;
    font-family: inherit;
    font-size: 0.72rem;
    text-align: left;
    color: var(--text-secondary);
    transition: background var(--transition-fast), color var(--transition-fast);
    white-space: nowrap;
    overflow: hidden;
  }

  .row:hover {
    background: rgba(var(--accent-rgb), 0.07);
    color: var(--text-primary);
  }

  .is-dir .name {
    color: var(--accent-primary);
  }

  .twisty {
    flex-shrink: 0;
    width: 0.7em;
    font-size: 0.6rem;
    color: var(--text-dim);
    transition: transform var(--transition-fast);
  }

  .twisty.open {
    transform: rotate(90deg);
  }

  .twisty.spacer {
    visibility: hidden;
  }

  .glyph {
    flex-shrink: 0;
    font-size: 0.6rem;
    color: var(--text-dim);
  }

  .is-dir .glyph {
    color: var(--accent-primary);
  }

  .name {
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .link-mark {
    color: var(--text-dim);
    font-size: 0.65rem;
  }

  .hint {
    font-size: 0.62rem;
    color: var(--text-dim);
    padding-top: 0.1rem;
    padding-bottom: 0.1rem;
    letter-spacing: 0.05em;
  }

  .hint.dim {
    opacity: 0.6;
    font-style: italic;
  }

  .hint.err {
    color: var(--accent-secondary);
  }
</style>
