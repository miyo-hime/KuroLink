<script lang="ts">
  import { getContext } from "svelte";
  import { slide } from "svelte/transition";
  import { cubicOut } from "svelte/easing";
  import type { SftpEntry, FileMenuTarget } from "../lib/types";
  import { sftpListDir } from "../lib/ipc";
  import { transfers } from "../lib/transfers.svelte";
  import { fileGlyph, humanSize, formatMtime } from "../lib/fileKind";
  import { HIGHLIGHT_KEY, type TreeHighlight } from "../lib/treeHighlight";
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

  const highlight = getContext<TreeHighlight>(HIGHLIGHT_KEY);
  let isNew = $derived(highlight?.path === entry.path);

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

  let dropActive = $state(false);

  // dirs swallow file drops onto themselves (uploads land inside, not at root);
  // file rows ignore them so the drop bubbles up to the panel
  function onRowDragOver(e: DragEvent) {
    if (!entry.is_dir || !e.dataTransfer?.types.includes("Files")) return;
    e.preventDefault();
    e.stopPropagation();
    dropActive = true;
  }

  function onRowDragLeave() {
    dropActive = false;
  }

  function onRowDrop(e: DragEvent) {
    if (!entry.is_dir) return;
    const files = e.dataTransfer?.files;
    if (!files || files.length === 0) return;
    e.preventDefault();
    e.stopPropagation();
    dropActive = false;
    transfers.uploadFiles(sessionId, entry.path, [...files], expandReload);
  }

  function rowContextMenu(e: MouseEvent) {
    onContextMenu(e, {
      entry,
      reloadList,
      reloadChildren: entry.is_dir ? expandReload : undefined,
    });
  }

  let rowTitle = $derived(
    entry.is_dir
      ? entry.path
      : `${entry.path}\n${humanSize(entry.size)}${entry.modified ? ` · ${formatMtime(entry.modified)}` : ""}`,
  );
</script>

<div class="node">
  <button
    class="row {entry.is_dir ? 'is-dir' : 'is-file'}"
    class:just-created={isNew}
    class:drop-target={dropActive}
    style="padding-left: {depth * 14 + 8}px"
    onclick={onRowClick}
    oncontextmenu={rowContextMenu}
    ondragover={onRowDragOver}
    ondragleave={onRowDragLeave}
    ondrop={onRowDrop}
    title={rowTitle}
    tabindex={-1}
    data-dir={entry.is_dir}
    data-expanded={expanded}
    data-depth={depth}
  >
    {#if entry.is_dir}
      <span class="twisty" class:open={expanded}>▸</span>
    {:else}
      <span class="twisty spacer"></span>
    {/if}
    <span class="glyph">{entry.is_dir ? "▣" : fileGlyph(entry.name)}</span>
    <span class="name">{entry.name}</span>
    {#if entry.is_symlink}<span class="link-mark">→</span>{/if}
    {#if !entry.is_dir}<span class="size">{humanSize(entry.size)}</span>{/if}
  </button>

  {#if loading}
    <div class="hint" style="padding-left: {(depth + 1) * 14 + 8}px">scanning...</div>
  {/if}
  {#if error}
    <div class="hint err" style="padding-left: {(depth + 1) * 14 + 8}px" title={error}>access denied</div>
  {/if}

  {#if expanded && children}
    <div class="children" transition:slide={{ duration: 140, easing: cubicOut }}>
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
    </div>
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

  /* a freshly created file/folder pulses once so you can spot where it landed */
  .row.just-created {
    animation: just-created 1.1s ease-out;
  }

  @keyframes just-created {
    0%,
    15% {
      background: rgba(var(--accent-rgb), 0.28);
      color: var(--text-primary);
    }
    100% {
      background: transparent;
    }
  }

  /* a dir lit up as an upload target while you hover files over it */
  .row.drop-target {
    background: rgba(var(--accent-rgb), 0.18);
    box-shadow: inset 0 0 0 1px rgba(var(--accent-rgb), 0.6);
    color: var(--text-primary);
  }

  /* keyboard focus doubles as selection */
  .row:focus {
    outline: none;
    background: rgba(var(--accent-rgb), 0.12);
    color: var(--text-primary);
    box-shadow: inset 2px 0 0 var(--accent-primary);
  }

  .row:focus .size {
    color: var(--text-secondary);
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
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .link-mark {
    flex-shrink: 0;
    color: var(--text-dim);
    font-size: 0.65rem;
  }

  .size {
    flex-shrink: 0;
    margin-left: 0.5rem;
    font-size: 0.6rem;
    color: var(--text-dim);
    font-variant-numeric: tabular-nums;
    opacity: 0.75;
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
