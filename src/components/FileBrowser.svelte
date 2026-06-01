<script lang="ts">
  import { onMount, setContext } from "svelte";
  import { HIGHLIGHT_KEY, type TreeHighlight } from "../lib/treeHighlight";
  import type { SftpEntry, FileMenuTarget } from "../lib/types";
  import {
    sftpListDir,
    sftpRealpath,
    sftpMkdir,
    sftpCreateFile,
    sftpRemove,
    sftpRename,
  } from "../lib/ipc";
  import FileTreeNode from "./FileTreeNode.svelte";
  import { transfers } from "../lib/transfers.svelte";

  interface Props {
    sessionId: string;
    onClose: () => void;
    onOpenFile: (sessionId: string, path: string) => void;
  }

  let { sessionId, onClose, onOpenFile }: Props = $props();

  let home = $state("");
  let root = $state<SftpEntry[] | null>(null);
  let loading = $state(false);
  let error = $state<string | null>(null);

  type Menu =
    | { x: number; y: number; kind: "node"; target: FileMenuTarget }
    | { x: number; y: number; kind: "root" };
  type Dialog =
    | {
        kind: "input";
        title: string;
        value: string;
        placeholder: string;
        confirmLabel: string;
        run: (value: string) => Promise<void>;
      }
    | {
        kind: "confirm";
        title: string;
        message: string;
        confirmLabel: string;
        run: () => Promise<void>;
      };

  let menu = $state<Menu | null>(null);
  let dialog = $state<Dialog | null>(null);
  let busy = $state(false);
  let actionError = $state<string | null>(null);

  let menuEl = $state<HTMLDivElement | null>(null);
  let inputEl = $state<HTMLInputElement | null>(null);
  let bodyEl = $state<HTMLDivElement | null>(null);

  // bumping this remounts every top-level node (and its subtree), which is the
  // whole collapse-all trick: fresh nodes start collapsed with cleared caches
  let treeVersion = $state(0);

  const highlight = $state<TreeHighlight>({ path: null });
  setContext(HIGHLIGHT_KEY, highlight);
  let flashTimer: ReturnType<typeof setTimeout> | undefined;

  function flashNew(path: string) {
    highlight.path = path;
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => (highlight.path = null), 1100);
  }

  function dirname(p: string): string {
    const i = p.lastIndexOf("/");
    return i <= 0 ? "/" : p.slice(0, i);
  }

  function joinPath(dir: string, name: string): string {
    return dir.endsWith("/") ? `${dir}${name}` : `${dir}/${name}`;
  }

  async function load() {
    loading = true;
    error = null;
    menu = null;
    dialog = null;
    actionError = null;
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

  // the top level's list - what new-folder-at-root and reorders refresh
  async function reloadRoot() {
    root = await sftpListDir(sessionId, home);
  }

  function openMenu(e: MouseEvent, target: FileMenuTarget) {
    e.preventDefault();
    menu = { x: e.clientX, y: e.clientY, kind: "node", target };
  }

  // kill the webview's native menu panel-wide; right-click on empty tree space
  // gets our own root menu instead (a node row sets its own menu and we leave it)
  function onPanelContextMenu(e: MouseEvent) {
    e.preventDefault();
    const t = e.target as HTMLElement;
    if (t.closest(".row")) return;
    if (bodyEl?.contains(t) && home) {
      menu = { x: e.clientX, y: e.clientY, kind: "root" };
    } else {
      menu = null;
    }
  }

  function collapseAll() {
    treeVersion++;
  }

  let dropActive = $state(false);

  function onPanelDragOver(e: DragEvent) {
    if (!home || !e.dataTransfer?.types.includes("Files")) return;
    e.preventDefault();
    dropActive = true;
  }

  function onPanelDragLeave(e: DragEvent) {
    // ignore bubbling from child rows - only clear when the cursor actually leaves
    if (e.relatedTarget && (e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) return;
    dropActive = false;
  }

  // a drop that wasn't caught by a dir row lands here -> goes to the panel root (home)
  function onPanelDrop(e: DragEvent) {
    dropActive = false;
    const files = e.dataTransfer?.files;
    if (!home || !files || files.length === 0) return;
    e.preventDefault();
    transfers.uploadFiles(sessionId, home, [...files], reloadRoot);
  }

  function uploadToRoot() {
    transfers.uploadPicker(sessionId, home, reloadRoot);
  }

  function startDownload(target: FileMenuTarget) {
    menu = null;
    transfers.download(sessionId, target.entry);
  }

  function startUpload(target: FileMenuTarget) {
    menu = null;
    transfers.uploadPicker(sessionId, target.entry.path, target.reloadChildren);
  }

  function newFolderAtRoot() {
    dialog = {
      kind: "input",
      title: "NEW FOLDER",
      value: "",
      placeholder: "folder name",
      confirmLabel: "CREATE",
      run: async (name) => {
        const path = joinPath(home, name);
        await sftpMkdir(sessionId, path);
        await reloadRoot();
        flashNew(path);
      },
    };
  }

  function newFileAtRoot() {
    dialog = {
      kind: "input",
      title: "NEW FILE",
      value: "",
      placeholder: "file name",
      confirmLabel: "CREATE",
      run: async (name) => {
        const path = joinPath(home, name);
        await sftpCreateFile(sessionId, path);
        await reloadRoot();
        flashNew(path);
        onOpenFile(sessionId, path);
      },
    };
  }

  function startNewFile(target: FileMenuTarget) {
    menu = null;
    dialog = {
      kind: "input",
      title: "NEW FILE",
      value: "",
      placeholder: "file name",
      confirmLabel: "CREATE",
      run: async (name) => {
        const path = joinPath(target.entry.path, name);
        await sftpCreateFile(sessionId, path);
        await target.reloadChildren?.();
        flashNew(path);
        onOpenFile(sessionId, path);
      },
    };
  }

  function startNewFolder(target: FileMenuTarget) {
    menu = null;
    dialog = {
      kind: "input",
      title: "NEW FOLDER",
      value: "",
      placeholder: "folder name",
      confirmLabel: "CREATE",
      run: async (name) => {
        const path = joinPath(target.entry.path, name);
        await sftpMkdir(sessionId, path);
        await target.reloadChildren?.();
        flashNew(path);
      },
    };
  }

  function startRename(target: FileMenuTarget) {
    menu = null;
    dialog = {
      kind: "input",
      title: "RENAME",
      value: target.entry.name,
      placeholder: "new name",
      confirmLabel: "RENAME",
      run: async (name) => {
        const to = joinPath(dirname(target.entry.path), name);
        await sftpRename(sessionId, target.entry.path, to);
        await target.reloadList();
      },
    };
  }

  function startDelete(target: FileMenuTarget) {
    menu = null;
    const what = target.entry.is_dir ? "directory" : "file";
    dialog = {
      kind: "confirm",
      title: "DELETE",
      message: `Drop ${what} "${target.entry.name}"? No undo, no take-backs.`,
      confirmLabel: "DELETE",
      run: async () => {
        await sftpRemove(sessionId, target.entry.path);
        await target.reloadList();
      },
    };
  }

  async function runDialog() {
    if (!dialog || busy) return;
    busy = true;
    actionError = null;
    try {
      if (dialog.kind === "input") {
        const value = dialog.value.trim();
        if (!value) {
          busy = false;
          return;
        }
        await dialog.run(value);
      } else {
        await dialog.run();
      }
      dialog = null;
    } catch (e) {
      actionError = String(e);
    } finally {
      busy = false;
    }
  }

  function onTreeKeydown(e: KeyboardEvent) {
    if (dialog) return;
    const rows = bodyEl
      ? [...bodyEl.querySelectorAll<HTMLButtonElement>(".row")]
      : [];
    if (rows.length === 0) return;

    const i = rows.indexOf(document.activeElement as HTMLButtonElement);
    const focusRow = (n: number) => {
      const r = rows[Math.max(0, Math.min(n, rows.length - 1))];
      r?.focus();
      r?.scrollIntoView({ block: "nearest" });
    };

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        focusRow(i < 0 ? 0 : i + 1);
        break;
      case "ArrowUp":
        e.preventDefault();
        focusRow(i < 0 ? rows.length - 1 : i - 1);
        break;
      case "Home":
        e.preventDefault();
        focusRow(0);
        break;
      case "End":
        e.preventDefault();
        focusRow(rows.length - 1);
        break;
      case "ArrowRight": {
        e.preventDefault();
        if (i < 0) return focusRow(0);
        const row = rows[i];
        if (row.dataset.dir !== "true") return;
        if (row.dataset.expanded === "true") focusRow(i + 1);
        else row.click();
        break;
      }
      case "ArrowLeft": {
        if (i < 0) return;
        e.preventDefault();
        const row = rows[i];
        if (row.dataset.dir === "true" && row.dataset.expanded === "true") {
          row.click();
          return;
        }
        const depth = Number(row.dataset.depth ?? 0);
        for (let j = i - 1; j >= 0; j--) {
          if (Number(rows[j].dataset.depth ?? 0) < depth) {
            focusRow(j);
            break;
          }
        }
        break;
      }
    }
  }

  onMount(() => {
    const onDown = (e: MouseEvent) => {
      if (menuEl && !menuEl.contains(e.target as Node)) menu = null;
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        menu = null;
        if (!busy) dialog = null;
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      clearTimeout(flashTimer);
    };
  });

  // autofocus the rename/new-folder field when a text dialog opens
  $effect(() => {
    if (dialog?.kind === "input" && inputEl) {
      inputEl.focus();
      inputEl.select();
    }
  });

  // reload whenever we point at a different session
  $effect(() => {
    sessionId;
    load();
  });
</script>

<aside
  class="file-browser"
  class:dropping={dropActive}
  oncontextmenu={onPanelContextMenu}
  ondragover={onPanelDragOver}
  ondragleave={onPanelDragLeave}
  ondrop={onPanelDrop}
>
  <header class="fb-header">
    <span class="fb-title">FILES</span>
    <div class="fb-actions">
      <button
        class="fb-btn"
        onclick={newFileAtRoot}
        disabled={!home}
        title="New file here"
        aria-label="New file"
      >＋</button>
      <button
        class="fb-btn"
        onclick={newFolderAtRoot}
        disabled={!home}
        title="New folder here"
        aria-label="New folder"
      >⊞</button>
      <button
        class="fb-btn"
        onclick={uploadToRoot}
        disabled={!home}
        title="Upload here"
        aria-label="Upload here"
      >▲</button>
      <button class="fb-btn" onclick={collapseAll} title="Collapse all" aria-label="Collapse all">⊟</button>
      <button class="fb-btn" onclick={load} title="Refresh" aria-label="Refresh">⟳</button>
      <button class="fb-btn" onclick={onClose} title="Close" aria-label="Close">✕</button>
    </div>
  </header>

  {#if home}
    <div class="fb-path" title={home}>{home}</div>
  {/if}

  {#if actionError}
    <div class="fb-banner" title={actionError}>{actionError}</div>
  {/if}

  <div
    class="fb-body"
    bind:this={bodyEl}
    role="tree"
    tabindex="0"
    onkeydown={onTreeKeydown}
  >
    {#if loading}
      <div class="fb-state">MOUNTING FS...</div>
    {:else if error}
      <div class="fb-state err">{error}</div>
    {:else if root}
      {#each root as entry (entry.path + "::" + treeVersion)}
        <FileTreeNode
          {entry}
          {sessionId}
          depth={0}
          reloadList={reloadRoot}
          onContextMenu={openMenu}
          {onOpenFile}
        />
      {/each}
      {#if root.length === 0}
        <div class="fb-state dim">empty directory</div>
      {/if}
    {/if}
  </div>

  {#if dropActive}
    <div class="fb-drop-overlay">
      <span>▲ DROP TO UPLOAD</span>
    </div>
  {/if}

  {#if menu}
    <div bind:this={menuEl} class="fb-context" style="left: {menu.x}px; top: {menu.y}px;">
      {#if menu.kind === "root"}
        <button class="fb-context-item" onclick={() => { menu = null; newFileAtRoot(); }}>New File</button>
        <button class="fb-context-item" onclick={() => { menu = null; newFolderAtRoot(); }}>New Folder</button>
        <button class="fb-context-item" onclick={uploadToRoot}>Upload Here</button>
      {:else}
        {@const target = menu.target}
        {#if target.entry.is_dir}
          <button class="fb-context-item" onclick={() => startNewFile(target)}>New File</button>
          <button class="fb-context-item" onclick={() => startNewFolder(target)}>New Folder</button>
          <button class="fb-context-item" onclick={() => startUpload(target)}>Upload Here</button>
        {:else}
          <button class="fb-context-item" onclick={() => startDownload(target)}>Download</button>
        {/if}
        <button class="fb-context-item" onclick={() => startRename(target)}>Rename</button>
        <button class="fb-context-item danger" onclick={() => startDelete(target)}>Delete</button>
      {/if}
    </div>
  {/if}

  {#if dialog}
    <div class="fb-dialog-scrim">
      <div class="fb-dialog">
        <div class="fb-dialog-title">{dialog.title}</div>
        {#if dialog.kind === "input"}
          <input
            bind:this={inputEl}
            class="fb-dialog-input"
            bind:value={dialog.value}
            placeholder={dialog.placeholder}
            spellcheck="false"
            autocomplete="off"
            onkeydown={(e) => {
              if (e.key === "Enter") runDialog();
            }}
          />
        {:else}
          <div class="fb-dialog-msg">{dialog.message}</div>
        {/if}
        {#if actionError}
          <div class="fb-dialog-err">{actionError}</div>
        {/if}
        <div class="fb-dialog-actions">
          <button class="fb-dialog-btn cancel" onclick={() => (dialog = null)} disabled={busy}>CANCEL</button>
          <button
            class="fb-dialog-btn confirm {dialog.kind === 'confirm' ? 'danger' : ''}"
            onclick={runDialog}
            disabled={busy}
          >
            {busy ? "..." : dialog.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  {/if}
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

  .file-browser.dropping {
    background: rgba(var(--accent-rgb), 0.05);
  }

  .fb-drop-overlay {
    position: absolute;
    inset: 0;
    z-index: 2200;
    display: grid;
    place-items: center;
    pointer-events: none;
    background: rgba(8, 8, 16, 0.45);
    border: 1px dashed rgba(var(--accent-rgb), 0.6);
    color: var(--accent-primary);
    font-size: 0.62rem;
    font-weight: 700;
    letter-spacing: 0.18em;
    text-shadow: 0 0 10px rgba(var(--accent-rgb), 0.5);
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

  .fb-btn:hover:not(:disabled) {
    color: var(--accent-primary);
    border-color: var(--accent-primary);
    background: rgba(var(--accent-rgb), 0.06);
  }

  .fb-btn:disabled {
    opacity: 0.3;
    cursor: default;
  }

  .fb-banner {
    padding: 0.35rem 0.7rem;
    font-size: 0.6rem;
    line-height: 1.35;
    color: var(--accent-secondary);
    background: rgba(232, 37, 78, 0.08);
    border-bottom: 1px solid rgba(232, 37, 78, 0.25);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    flex-shrink: 0;
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

  /* context menu */
  .fb-context {
    position: fixed;
    min-width: 130px;
    background: var(--bg-secondary);
    border: 1px solid var(--border-subtle);
    border-top: 2px solid var(--accent-primary);
    z-index: 2000;
    padding: 0.25rem 0;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.5);
    transform-origin: top left;
    animation: ctx-pop 95ms cubic-bezier(0.2, 0.9, 0.3, 1);
  }

  @keyframes ctx-pop {
    from {
      opacity: 0;
      transform: scale(0.95);
    }
  }

  .fb-context-item {
    display: block;
    width: 100%;
    background: none;
    border: none;
    color: var(--text-secondary);
    font-family: inherit;
    font-size: 0.68rem;
    padding: 0.35rem 0.75rem;
    cursor: pointer;
    text-align: left;
    letter-spacing: 0.03em;
    transition: all var(--transition-fast);
  }

  .fb-context-item:hover {
    color: var(--accent-primary);
    background: rgba(var(--accent-rgb), 0.05);
  }

  .fb-context-item.danger:hover {
    color: var(--accent-secondary);
    background: rgba(232, 37, 78, 0.08);
  }

  /* new folder / rename / delete dialog */
  .fb-dialog-scrim {
    position: absolute;
    inset: 0;
    z-index: 2500;
    display: grid;
    place-items: center;
    padding: 0.75rem;
    background: rgba(6, 6, 14, 0.6);
    backdrop-filter: blur(2px);
    animation: scrim-fade 120ms ease;
  }

  @keyframes scrim-fade {
    from {
      opacity: 0;
    }
  }

  .fb-dialog {
    width: 100%;
    background: rgba(16, 14, 28, 0.97);
    border: 1px solid var(--border-glow);
    border-top: 2px solid var(--accent-primary);
    padding: 0.8rem 0.85rem;
    clip-path: polygon(
      0 0,
      calc(100% - 8px) 0,
      100% 8px,
      100% 100%,
      8px 100%,
      0 calc(100% - 8px)
    );
    animation: dialog-pop 140ms cubic-bezier(0.2, 0.9, 0.3, 1);
  }

  @keyframes dialog-pop {
    from {
      opacity: 0;
      transform: translateY(6px) scale(0.98);
    }
  }

  .fb-dialog-title {
    color: var(--accent-primary);
    font-size: 0.62rem;
    font-weight: 700;
    letter-spacing: 0.18em;
    margin-bottom: 0.6rem;
  }

  .fb-dialog-input {
    width: 100%;
    background: rgba(8, 8, 16, 0.6);
    border: 1px solid var(--border-glow);
    color: var(--text-primary);
    font-family: inherit;
    font-size: 0.72rem;
    padding: 0.35rem 0.45rem;
    outline: none;
    transition: border-color var(--transition-fast);
  }

  .fb-dialog-input:focus {
    border-color: var(--accent-primary);
  }

  .fb-dialog-msg {
    color: var(--text-secondary);
    font-size: 0.68rem;
    line-height: 1.45;
  }

  .fb-dialog-err {
    margin-top: 0.5rem;
    color: var(--accent-secondary);
    font-size: 0.6rem;
    line-height: 1.35;
  }

  .fb-dialog-actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.4rem;
    margin-top: 0.75rem;
  }

  .fb-dialog-btn {
    background: transparent;
    border: 1px solid var(--border-glow);
    color: var(--text-secondary);
    font-family: inherit;
    font-size: 0.62rem;
    font-weight: 600;
    letter-spacing: 0.08em;
    padding: 0.3rem 0.7rem;
    cursor: pointer;
    transition: all var(--transition-fast);
  }

  .fb-dialog-btn:disabled {
    opacity: 0.4;
    cursor: default;
  }

  .fb-dialog-btn.confirm:hover:not(:disabled) {
    color: var(--accent-primary);
    border-color: var(--accent-primary);
    background: rgba(var(--accent-rgb), 0.08);
  }

  .fb-dialog-btn.confirm.danger:hover:not(:disabled) {
    color: var(--accent-secondary);
    border-color: var(--accent-secondary);
    background: rgba(232, 37, 78, 0.1);
  }

  .fb-dialog-btn.cancel:hover:not(:disabled) {
    color: var(--text-primary);
    border-color: var(--text-secondary);
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
