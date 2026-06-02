<script lang="ts">
  import { onMount } from "svelte";
  import type { Tab, Pane, ConnectionProfile, LocalShellId, LocalShellInfo } from "../lib/types";
  import { panesOf, findPane } from "../lib/paneTree";

  interface Props {
    tabs: Tab[];
    activeTabId: string | null;
    dirtyTabs: Set<string>;
    profiles: ConnectionProfile[];
    onSelectTab: (tabId: string) => void;
    onCloseTab: (tabId: string) => void;
    onNewTab: () => void;
    onNewSshTab: (profileId: string) => void;
    onNewLocalTab: (shellType: LocalShellId) => void;
    localShells: LocalShellInfo[];
    onReorderTabs: (fromIndex: number, toIndex: number) => void;
    onOpenFile: (sessionId: string, path: string) => void;
  }

  let {
    tabs,
    activeTabId,
    dirtyTabs,
    profiles,
    onSelectTab,
    onCloseTab,
    onNewTab,
    onNewSshTab,
    onNewLocalTab,
    localShells,
    onReorderTabs,
    onOpenFile,
  }: Props = $props();

  interface ContextMenu {
    x: number;
    y: number;
    tabId: string;
  }

  function head(tab: Tab): Pane | null {
    return findPane(tab.layout, tab.activePaneId);
  }
  function isSplit(tab: Tab): boolean {
    return panesOf(tab.layout).length > 1;
  }
  function isDirty(tab: Tab): boolean {
    return panesOf(tab.layout).some((p) => dirtyTabs.has(p.paneId));
  }

  let dropdownOpen = $state(false);
  let contextMenu = $state<ContextMenu | null>(null);
  let dragIndex = $state<number | null>(null);
  let dropIndex = $state<number | null>(null);
  let dropdownPos = $state<{ top: number; left: number } | null>(null);

  let dropdownEl = $state<HTMLDivElement | null>(null);
  let arrowEl = $state<HTMLButtonElement | null>(null);
  let contextEl = $state<HTMLDivElement | null>(null);
  let fileDragOver = $state(false);

  const TAB_DRAG = "application/x-kurolink-tab";
  const FILE_DRAG = "application/x-kurolink-file";

  // close dropdown/context menu on click-outside
  onMount(() => {
    const handleClick = (e: MouseEvent) => {
      if (dropdownEl && !dropdownEl.contains(e.target as Node)) {
        dropdownOpen = false;
      }
      if (contextEl && !contextEl.contains(e.target as Node)) {
        contextMenu = null;
      }
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        dropdownOpen = false;
        contextMenu = null;
      }
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleEsc);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleEsc);
    };
  });

  // -- drag reorder --
  function handleDragStart(e: DragEvent, index: number) {
    dragIndex = index;
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = "move";
      // firefox needs this
      e.dataTransfer.setData("text/plain", String(index));
      // panes read this to graft-on-drop; the custom type keeps file/text drags out of it
      e.dataTransfer.setData("application/x-kurolink-tab", tabs[index].id);
    }
  }

  function handleDragOver(e: DragEvent, index: number) {
    // a file drag isn't a reorder - let it bubble to the bar's new-tab drop zone
    if (!e.dataTransfer?.types.includes(TAB_DRAG)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    dropIndex = index;
  }

  function handleDrop(e: DragEvent, toIndex: number) {
    e.preventDefault();
    if (dragIndex !== null && dragIndex !== toIndex) {
      onReorderTabs(dragIndex, toIndex);
    }
    dragIndex = null;
    dropIndex = null;
  }

  function handleDragEnd() {
    dragIndex = null;
    dropIndex = null;
  }

  // a file dragged from the browser onto the strip opens as a new tab
  function handleBarDragOver(e: DragEvent) {
    if (!e.dataTransfer?.types.includes(FILE_DRAG)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    fileDragOver = true;
  }

  function handleBarDragLeave(e: DragEvent) {
    if (e.relatedTarget && (e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) return;
    fileDragOver = false;
  }

  function handleBarDrop(e: DragEvent) {
    fileDragOver = false;
    const raw = e.dataTransfer?.getData(FILE_DRAG);
    if (!raw) return;
    e.preventDefault();
    const { sessionId, path } = JSON.parse(raw);
    onOpenFile(sessionId, path);
  }

  // -- context menu --
  function handleContextMenu(e: MouseEvent, tabId: string) {
    e.preventDefault();
    contextMenu = { x: e.clientX, y: e.clientY, tabId };
  }

  // middle-click to close
  function handleMouseDown(e: MouseEvent, tabId: string) {
    if (e.button === 1) {
      e.preventDefault();
      onCloseTab(tabId);
    }
  }

  // context menu actions
  function contextCloseOthers() {
    if (!contextMenu) return;
    const target = contextMenu.tabId;
    tabs.forEach((t) => {
      if (t.id !== target) onCloseTab(t.id);
    });
    contextMenu = null;
  }

  function contextCloseToRight() {
    if (!contextMenu) return;
    const idx = tabs.findIndex((t) => t.id === contextMenu!.tabId);
    if (idx === -1) return;
    tabs.slice(idx + 1).forEach((t) => onCloseTab(t.id));
    contextMenu = null;
  }

  function toggleDropdown() {
    if (!dropdownOpen && arrowEl) {
      const rect = arrowEl.getBoundingClientRect();
      const menuWidth = 220;
      // anchor left to the button, but clamp so it doesn't overflow either edge
      let left = rect.left;
      if (left + menuWidth > window.innerWidth) {
        left = window.innerWidth - menuWidth - 4;
      }
      if (left < 4) left = 4;
      dropdownPos = { top: rect.bottom, left };
    }
    dropdownOpen = !dropdownOpen;
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="tab-bar"
  class:file-drop={fileDragOver}
  ondragover={handleBarDragOver}
  ondragleave={handleBarDragLeave}
  ondrop={handleBarDrop}
>
  <div class="tab-scroll">
    {#each tabs as tab, index (tab.id)}
      {@const h = head(tab)}
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <div
        class="tab"
        class:tab-active={tab.id === activeTabId}
        class:tab-dragging={dragIndex === index}
        class:tab-drop-target={dropIndex === index && dragIndex !== index}
        onclick={() => onSelectTab(tab.id)}
        onmousedown={(e) => handleMouseDown(e, tab.id)}
        oncontextmenu={(e) => handleContextMenu(e, tab.id)}
        draggable="true"
        ondragstart={(e) => handleDragStart(e, index)}
        ondragover={(e) => handleDragOver(e, index)}
        ondrop={(e) => handleDrop(e, index)}
        ondragend={handleDragEnd}
        role="tab"
        tabindex="0"
        aria-selected={tab.id === activeTabId}
      >
        {#if h?.backend.kind === "ssh"}
          <span class="tab-indicator tab-indicator-ssh" title="SSH: {h.backend.profileName}"></span>
        {:else if h?.backend.kind === "editor"}
          <span class="tab-indicator tab-indicator-editor" title="Editing: {h.backend.path}"></span>
        {:else}
          <span class="tab-indicator tab-indicator-local" title="Local: {h?.backend.kind === 'local' ? h.backend.shellType : ''}"></span>
        {/if}
        <span class="tab-index">{index + 1}.</span>
        <span class="tab-title">{h?.title ?? "tab"}</span>
        {#if isSplit(tab)}<span class="tab-split" title="Split into panes">⊞</span>{/if}
        {#if isDirty(tab)}<span class="tab-dirty" title="Unsaved changes">●</span>{/if}
        <button
          class="tab-close"
          onclick={(e) => {
            e.stopPropagation();
            onCloseTab(tab.id);
          }}
        >
          ×
        </button>
      </div>
    {/each}
  </div>

  <!-- new tab: split button -->
  <div class="tab-new-group">
    <button class="tab-new" onclick={onNewTab} title="New tab (same connection)">
      +
    </button>
    <div class="tab-dropdown-wrapper" bind:this={dropdownEl}>
      <button
        bind:this={arrowEl}
        class="tab-dropdown-arrow {dropdownOpen ? 'tab-dropdown-open' : ''}"
        onclick={toggleDropdown}
        title="Open new connection"
      >
        ▾
      </button>
      {#if dropdownOpen && dropdownPos}
        <div class="tab-dropdown" style="top: {dropdownPos.top}px; left: {dropdownPos.left}px;">
          <div class="tab-dropdown-section">LOCAL</div>
          {#each localShells.filter((shell) => shell.available) as shell (shell.id)}
            <button
              class="tab-dropdown-item"
              onclick={() => { onNewLocalTab(shell.id); dropdownOpen = false; }}
            >
              {shell.label}
            </button>
          {/each}
          {#if profiles.length > 0}
            <div class="tab-dropdown-divider"></div>
            <div class="tab-dropdown-section">SSH PROFILES</div>
            {#each profiles as p (p.id)}
              <button
                class="tab-dropdown-item"
                onclick={() => { onNewSshTab(p.id); dropdownOpen = false; }}
              >
                <span class="tab-dropdown-profile-name">{p.name}</span>
                <span class="tab-dropdown-profile-host">{p.host}</span>
              </button>
            {/each}
          {/if}
        </div>
      {/if}
    </div>
  </div>

  <!-- context menu -->
  {#if contextMenu}
    <div
      bind:this={contextEl}
      class="tab-context-menu"
      style="left: {contextMenu.x}px; top: {contextMenu.y}px;"
    >
      <button
        class="tab-context-item"
        onclick={() => {
          onCloseTab(contextMenu!.tabId);
          contextMenu = null;
        }}
      >
        Close
      </button>
      {#if tabs.length > 1}
        <button class="tab-context-item" onclick={contextCloseOthers}>
          Close Others
        </button>
      {/if}
      {#if tabs.findIndex((t) => t.id === contextMenu!.tabId) < tabs.length - 1}
        <button class="tab-context-item" onclick={contextCloseToRight}>
          Close to Right
        </button>
      {/if}
    </div>
  {/if}
</div>

<style>
  .tab-bar {
    display: flex;
    align-items: stretch;
    background: var(--bg-secondary);
    border-bottom: 1px solid var(--border-subtle);
    height: 32px;
    flex-shrink: 0;
    position: relative;
  }

  /* a file's hovering, ready to land as a new tab */
  .tab-bar.file-drop {
    box-shadow: inset 0 0 0 1px rgba(var(--accent-rgb), 0.6);
    background: rgba(var(--accent-rgb), 0.08);
  }

  /* scrollable tab area */
  .tab-scroll {
    display: flex;
    align-items: stretch;
    overflow-x: auto;
    min-width: 0;
    mask-image: linear-gradient(
      to right,
      transparent 0px,
      black 8px,
      black calc(100% - 12px),
      transparent 100%
    );
    -webkit-mask-image: linear-gradient(
      to right,
      transparent 0px,
      black 8px,
      black calc(100% - 12px),
      transparent 100%
    );
    scrollbar-width: none;
  }

  .tab-scroll::-webkit-scrollbar {
    display: none;
  }

  .tab {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0 0.75rem;
    font-size: 0.7rem;
    letter-spacing: 0.05em;
    color: var(--text-dim);
    cursor: pointer;
    border-right: 1px solid rgba(74, 74, 100, 0.15);
    transition: all var(--transition-fast);
    white-space: nowrap;
    position: relative;
    user-select: none;
  }

  .tab:hover {
    color: var(--text-primary);
    background: rgba(var(--accent-rgb), 0.03);
  }

  /* hover sweep */
  .tab::after {
    content: "";
    position: absolute;
    bottom: 0;
    left: 0;
    width: 0;
    height: 1px;
    background: var(--accent-primary);
    transition: width 0.25s ease;
  }

  .tab:hover::after {
    width: 100%;
  }

  .tab-active {
    color: var(--accent-primary);
    background: var(--bg-terminal);
  }

  /* active tab pip */
  .tab-active::before {
    content: "";
    position: absolute;
    left: 0;
    top: 25%;
    height: 50%;
    width: 2px;
    background: var(--accent-primary);
    box-shadow: var(--glow-sm) var(--accent-primary);
  }

  /* active tab glow */
  .tab-active::after {
    width: 100%;
    background: var(--accent-primary);
    opacity: 0.6;
  }

  /* tab type indicator dot */
  .tab-indicator {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .tab-indicator-ssh {
    background: var(--accent-primary);
    box-shadow: 0 0 4px var(--accent-primary);
  }

  .tab-indicator-local {
    background: #8ccc26;
    box-shadow: 0 0 4px #8ccc26;
  }

  .tab-indicator-editor {
    background: var(--accent-warning);
    box-shadow: 0 0 4px var(--accent-warning);
    border-radius: 1px;
  }

  .tab-index {
    color: var(--text-dim);
    font-size: 0.6rem;
    opacity: 0.6;
  }

  .tab-active .tab-index {
    color: var(--accent-primary);
    opacity: 0.8;
  }

  .tab-title {
    text-transform: uppercase;
  }

  .tab-dirty {
    color: var(--accent-warning);
    font-size: 0.5rem;
    line-height: 1;
    flex-shrink: 0;
  }

  .tab-split {
    color: var(--text-dim);
    font-size: 0.7rem;
    line-height: 1;
    flex-shrink: 0;
    opacity: 0.7;
  }

  .tab-active .tab-split {
    color: var(--accent-primary);
    opacity: 0.85;
  }

  .tab-close {
    background: none;
    border: none;
    color: inherit;
    font-size: 0.85rem;
    cursor: pointer;
    padding: 0 2px;
    opacity: 0.4;
    line-height: 1;
    transition: all var(--transition-fast);
  }

  .tab-close:hover {
    opacity: 1;
    color: var(--accent-secondary);
  }

  /* drag states */
  .tab-dragging {
    opacity: 0.4;
  }

  .tab-drop-target {
    border-left: 2px solid var(--accent-primary);
    box-shadow: inset 2px 0 8px -4px var(--accent-primary);
  }

  /* new tab split button */
  .tab-new-group {
    display: flex;
    align-items: stretch;
    flex-shrink: 0;
  }

  .tab-new {
    background: none;
    border: none;
    color: var(--text-dim);
    font-size: 0.85rem;
    padding: 0 0.5rem;
    cursor: pointer;
    transition: all var(--transition-fast);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .tab-new:hover {
    color: var(--accent-primary);
    text-shadow: var(--glow-sm) var(--accent-primary);
  }

  .tab-dropdown-wrapper {
    position: relative;
    display: flex;
    align-items: stretch;
  }

  .tab-dropdown-arrow {
    background: none;
    border: none;
    border-left: 1px solid rgba(74, 74, 100, 0.2);
    color: var(--text-dim);
    font-size: 1.1rem;
    padding: 0 0.5rem;
    cursor: pointer;
    transition: all var(--transition-fast);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .tab-dropdown-arrow:hover,
  .tab-dropdown-open {
    color: var(--accent-primary);
    background: rgba(var(--accent-rgb), 0.05);
  }

  /* dropdown menu */
  .tab-dropdown {
    position: fixed;
    min-width: 220px;
    background: var(--bg-secondary);
    border: 1px solid var(--border-subtle);
    border-top: 2px solid var(--accent-primary);
    z-index: 1000;
    padding: 0.25rem 0;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.5);
  }

  .tab-dropdown-section {
    font-size: 0.55rem;
    letter-spacing: 0.1em;
    color: var(--text-dim);
    padding: 0.4rem 0.75rem 0.15rem;
    opacity: 0.7;
  }

  .tab-dropdown-divider {
    height: 1px;
    background: var(--border-subtle);
    margin: 0.25rem 0;
  }

  .tab-dropdown-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    width: 100%;
    background: none;
    border: none;
    color: var(--text-secondary);
    font-size: 0.7rem;
    padding: 0.35rem 0.75rem;
    cursor: pointer;
    text-align: left;
    transition: all var(--transition-fast);
    letter-spacing: 0.03em;
  }

  .tab-dropdown-item:hover {
    color: var(--accent-primary);
    background: rgba(var(--accent-rgb), 0.05);
  }

  .tab-dropdown-profile-name {
    font-weight: 500;
  }

  .tab-dropdown-profile-host {
    font-size: 0.6rem;
    color: var(--text-dim);
    opacity: 0.7;
  }

  /* context menu */
  .tab-context-menu {
    position: fixed;
    min-width: 140px;
    background: var(--bg-secondary);
    border: 1px solid var(--border-subtle);
    border-top: 2px solid var(--accent-primary);
    z-index: 2000;
    padding: 0.25rem 0;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.5);
  }

  .tab-context-item {
    display: block;
    width: 100%;
    background: none;
    border: none;
    color: var(--text-secondary);
    font-size: 0.7rem;
    padding: 0.35rem 0.75rem;
    cursor: pointer;
    text-align: left;
    transition: all var(--transition-fast);
    letter-spacing: 0.03em;
  }

  .tab-context-item:hover {
    color: var(--accent-primary);
    background: rgba(var(--accent-rgb), 0.05);
  }
</style>
