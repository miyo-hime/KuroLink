<script lang="ts">
  import { onMount, untrack } from "svelte";
  import { DEFAULT_LOCAL_SHELLS } from "../lib/types";
  import type { ConnectionProfile, TerminalTab, SystemStats, ConnectionStatus, TabBackend, LocalShellId, LocalShellInfo } from "../lib/types";
  import { attachShortcuts } from "../lib/shortcuts";
  import {
    openShell,
    openSshShell,
    openLocalShell,
    closeShell,
    disconnectSsh,
    fetchSystemStats,
    fetchLocalStats,
    detectLocalShells,
    getProfiles,
    onSessionError,
  } from "../lib/ipc";
  import type { UnlistenFn } from "@tauri-apps/api/event";
  import TopBar from "./TopBar.svelte";
  import TabBar from "./TabBar.svelte";
  import StatusBar from "./StatusBar.svelte";
  import FileBrowser from "./FileBrowser.svelte";

  interface Props {
    initialSessionId: string | null;
    initialProfile: ConnectionProfile | null;
    initialLocalShell: LocalShellId | null;
    onDisconnected: () => void;
  }

  let { initialSessionId, initialProfile, initialLocalShell, onDisconnected }: Props = $props();

  const STATS_POLL_MS = 10_000;

  // ghostty chunk is heavy (inlined wasm), so the panel stays its own lazy import -
  // the connect screen never pays for it
  let TerminalPanel = $state<typeof import("./TerminalPanel.svelte")["default"] | null>(null);
  // codemirror rides this chunk; only pull it the first time a file actually opens, so
  // a pure-terminal session never pays for the editor
  let EditorPanel = $state<typeof import("./EditorPanel.svelte")["default"] | null>(null);

  function ensureEditorPanel() {
    if (!EditorPanel) import("./EditorPanel.svelte").then((m) => (EditorPanel = m.default));
  }

  let tabs = $state<TerminalTab[]>([]);
  let activeTabId = $state<string | null>(null);
  let stats = $state<SystemStats | null>(null);
  let prevStats = $state<SystemStats | null>(null);
  let searchVisible = $state(false);
  let filesVisible = $state(false);
  // editor dirty state lives OUTSIDE tabs on purpose - writing it into a tab object
  // would reassign `tabs` on every keystroke and yank focus out of the textarea
  let dirtyTabs = $state<Set<string>>(new Set());
  let lostSessions = $state<Set<string>>(new Set());
  let reconnecting = $state(false);
  let profiles = $state<ConnectionProfile[]>([]);
  let localShells = $state<LocalShellInfo[]>(DEFAULT_LOCAL_SHELLS);

  let tabCount = 0;
  let sessionListeners = new Map<string, UnlistenFn>();
  let closedTabStack: TerminalTab[] = [];
  let statsInFlight = false;
  let titleTimers = new Map<string, ReturnType<typeof setTimeout>>();

  // derived state from active tab
  let activeTab = $derived(tabs.find((t) => t.channelId === activeTabId));
  let activeSessionId = $derived(
    activeTab && (activeTab.backend.kind === "ssh" || activeTab.backend.kind === "editor")
      ? activeTab.backend.sessionId
      : null,
  );
  let activeHostname = $derived(
    activeTab?.backend.kind === "ssh"
      ? activeTab.backend.profileName
      : activeTab?.backend.kind === "editor"
        ? basename(activeTab.backend.path)
        : activeTab?.backend.kind === "local"
          ? activeTab.backend.shellType.toUpperCase()
          : "",
  );
  let isActiveLost = $derived(activeSessionId ? lostSessions.has(activeSessionId) : false);
  let connectionStatus = $derived<ConnectionStatus>(isActiveLost ? "lost" : "connected");
  let activeLatency = $derived(
    (activeTab?.backend.kind === "ssh" || activeTab?.backend.kind === "editor") && stats
      ? stats.latency_ms
      : null,
  );
  // sftp needs a live ssh session - local tabs and dead links don't get the panel
  let filesAvailable = $derived(activeSessionId != null && !isActiveLost);

  // first time a live ssh session lands in focus, swing the browser open - if you're
  // on a remote box you almost certainly want its fs in view. once only (plain flag,
  // not $state), so closing it sticks and reconnects/tab-hops don't keep re-popping it.
  let hasAutoOpenedFiles = false;
  $effect(() => {
    if (filesAvailable && !hasAutoOpenedFiles) {
      hasAutoOpenedFiles = true;
      filesVisible = true;
    }
  });

  // open a shell on an existing ssh session (used for initial tab + "+" duplication)
  async function createSshTabFromSession(sessionId: string, profile: ConnectionProfile) {
    try {
      const channelId = await openShell(sessionId, 80, 24);
      tabCount += 1;
      const name = profile.name || profile.host;
      const tab: TerminalTab = {
        channelId,
        title: `${name} ${tabCount}`,
        backend: { kind: "ssh", sessionId, profileId: profile.id, profileName: name },
      };
      tabs = [...tabs, tab];
      activeTabId = channelId;
    } catch (e) {
      console.error("failed to open shell:", e);
    }
  }

  async function createLocalTab(shellType: LocalShellId) {
    try {
      const channelId = await openLocalShell(shellType, 80, 24);
      tabCount += 1;
      const tab: TerminalTab = {
        channelId,
        title: `${shellType} ${tabCount}`,
        backend: { kind: "local", shellType },
      };
      tabs = [...tabs, tab];
      activeTabId = channelId;
    } catch (e) {
      console.error("failed to open local shell:", e);
    }
  }

  // connect to a profile (new or reuse session) and open a tab - used by dropdown
  async function createSshTabFromProfile(profileId: string) {
    try {
      const result = await openSshShell(profileId, 80, 24);
      tabCount += 1;
      const profile = profiles.find((p) => p.id === profileId);
      const name = profile?.name || profile?.host || "SSH";
      const tab: TerminalTab = {
        channelId: result.channel_id,
        title: `${name} ${tabCount}`,
        backend: { kind: "ssh", sessionId: result.session_id, profileId, profileName: name },
      };
      tabs = [...tabs, tab];
      activeTabId = result.channel_id;
    } catch (e) {
      console.error("failed to open ssh shell:", e);
    }
  }

  function basename(p: string): string {
    const i = p.lastIndexOf("/");
    return i < 0 ? p : p.slice(i + 1);
  }

  // open a remote file in an editor tab (or focus it if already open)
  function openEditorTab(sessionId: string, path: string) {
    ensureEditorPanel();
    const existing = tabs.find(
      (t) =>
        t.backend.kind === "editor" &&
        t.backend.sessionId === sessionId &&
        t.backend.path === path,
    );
    if (existing) {
      activeTabId = existing.channelId;
      return;
    }
    const channelId = `editor:${crypto.randomUUID()}`;
    const tab: TerminalTab = {
      channelId,
      title: basename(path),
      backend: { kind: "editor", sessionId, path },
    };
    tabs = [...tabs, tab];
    activeTabId = channelId;
  }

  // editor panel tells us when its buffer diverges - tracked off to the side so
  // the tab strip can show a dot without disturbing the editor's DOM
  function setEditorDirty(channelId: string, dirty: boolean) {
    if (dirtyTabs.has(channelId) === dirty) return;
    const next = new Set(dirtyTabs);
    if (dirty) next.add(channelId);
    else next.delete(channelId);
    dirtyTabs = next;
  }

  function handleReorderTabs(fromIndex: number, toIndex: number) {
    const next = [...tabs];
    const [moved] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, moved);
    tabs = next;
  }

  // "+" button: clone the active tab's connection type
  async function handleNewTab() {
    const tab = activeTab;
    if (!tab) return;

    if (tab.backend.kind === "local") {
      await createLocalTab(tab.backend.shellType);
      return;
    }

    // ssh tab clones directly; an editor tab has no PTY so we drop a shell on
    // the same host by borrowing a sibling ssh tab's profile
    const sessionId = tab.backend.sessionId;
    const sib =
      tab.backend.kind === "ssh"
        ? tab
        : tabs.find((t) => t.backend.kind === "ssh" && t.backend.sessionId === sessionId);
    if (!sib || sib.backend.kind !== "ssh") return;

    const { profileId, profileName } = sib.backend;
    try {
      const channelId = await openShell(sessionId, 80, 24);
      tabCount += 1;
      const newTab: TerminalTab = {
        channelId,
        title: `${profileName} ${tabCount}`,
        backend: { kind: "ssh", sessionId, profileId, profileName },
      };
      tabs = [...tabs, newTab];
      activeTabId = channelId;
    } catch (e) {
      console.error("failed to open shell:", e);
    }
  }

  async function handleCloseTab(channelId: string) {
    // save to closed stack for reopen (ctrl+shift+t)
    const closing = tabs.find((t) => t.channelId === channelId);
    if (closing) closedTabStack.push(closing);

    // editor tabs have no PTY behind them, nothing to tear down on the backend
    if (closing?.backend.kind !== "editor") {
      await closeShell(channelId).catch(() => {});
    } else if (dirtyTabs.has(channelId)) {
      const nextDirty = new Set(dirtyTabs);
      nextDirty.delete(channelId);
      dirtyTabs = nextDirty;
    }
    const next = tabs.filter((t) => t.channelId !== channelId);
    if (channelId === activeTabId && next.length > 0) {
      activeTabId = next[next.length - 1].channelId;
    }
    tabs = next;
    // if no tabs left, disconnect everything
    if (next.length === 0) handleDisconnect();
  }

  // windows shells set the title to full exe paths and command lines -
  // extract just the program name like windows terminal does
  function cleanLocalTitle(raw: string): string {
    let name = raw;
    // "C:\...\powershell.exe" -> extract basename
    if (/^[a-zA-Z]:\\/.test(name)) {
      name = name.split(/[/\\]/).pop() || name;
    } else {
      // "npm exec @playwright/mcp@latest" -> first token
      name = name.split(/\s+/)[0];
      if (name.includes("\\") || name.includes("/")) {
        name = name.split(/[/\\]/).pop() || name;
      }
    }
    return name.replace(/\.(exe|cmd|bat|com)$/i, "");
  }

  function handleTabTitleChange(channelId: string, title: string) {
    const applyTitle = (cleaned: string) => {
      tabs = tabs.map((t) => (t.channelId === channelId ? { ...t, title: cleaned } : t));
    };

    // ssh tabs: pass through immediately, shells handle titles well
    const tab = tabs.find((t) => t.channelId === channelId);
    if (!tab || tab.backend.kind !== "local") {
      applyTitle(title);
      return;
    }

    // local tabs: clean + throttle (200ms) to dodge flicker from rapid subprocess chains
    const cleaned = cleanLocalTitle(title);
    const existing = titleTimers.get(channelId);
    if (existing) clearTimeout(existing);
    titleTimers.set(
      channelId,
      setTimeout(() => {
        titleTimers.delete(channelId);
        applyTitle(cleaned);
      }, 200),
    );
  }

  async function handleDisconnect() {
    for (const tab of tabs) {
      await closeShell(tab.channelId).catch(() => {});
    }
    const sshSessionIds = new Set(
      tabs
        .filter((t) => t.backend.kind === "ssh")
        .map((t) => (t.backend as Extract<TabBackend, { kind: "ssh" }>).sessionId),
    );
    for (const sid of sshSessionIds) {
      await disconnectSsh(sid).catch(() => {});
    }
    for (const [, unlisten] of sessionListeners) unlisten();
    sessionListeners.clear();
    onDisconnected();
  }

  async function handleReconnect() {
    const sid = activeSessionId;
    if (!sid) return;
    reconnecting = true;
    try {
      const sshTab = tabs.find(
        (t) => t.backend.kind === "ssh" && t.backend.sessionId === sid,
      );
      if (!sshTab || sshTab.backend.kind !== "ssh") return;

      const result = await openSshShell(sshTab.backend.profileId, 80, 24);

      // clear lost status for old session
      const cleared = new Set(lostSessions);
      cleared.delete(sid);
      lostSessions = cleared;

      // remove dead tabs for the old session, add a fresh one
      tabCount += 1;
      const newTab: TerminalTab = {
        channelId: result.channel_id,
        title: `${sshTab.backend.profileName} ${tabCount}`,
        backend: {
          kind: "ssh",
          sessionId: result.session_id,
          profileId: sshTab.backend.profileId,
          profileName: sshTab.backend.profileName,
        },
      };
      const survivors = tabs.filter(
        (t) => !(t.backend.kind === "ssh" && t.backend.sessionId === sid),
      );
      tabs = [...survivors, newTab];
      activeTabId = result.channel_id;
    } catch (e) {
      console.error("reconnect failed:", e);
    } finally {
      reconnecting = false;
    }
  }

  async function handleReopenTab() {
    const last = closedTabStack.pop();
    if (!last) return;
    if (last.backend.kind === "ssh") {
      await createSshTabFromProfile(last.backend.profileId);
    } else if (last.backend.kind === "editor") {
      openEditorTab(last.backend.sessionId, last.backend.path);
    } else {
      await createLocalTab(last.backend.shellType);
    }
  }

  onMount(() => {
    import("./TerminalPanel.svelte").then((m) => (TerminalPanel = m.default));

    if (initialLocalShell) {
      createLocalTab(initialLocalShell);
    } else if (initialSessionId && initialProfile) {
      createSshTabFromSession(initialSessionId, initialProfile);
    }
    getProfiles().then((p) => (profiles = p)).catch(() => {});
    detectLocalShells().then((s) => (localShells = s)).catch(() => {});

    return attachShortcuts({
      onNextTab: () => {
        const idx = tabs.findIndex((t) => t.channelId === activeTabId);
        if (idx >= 0 && tabs.length > 1) {
          activeTabId = tabs[(idx + 1) % tabs.length].channelId;
        }
      },
      onPrevTab: () => {
        const idx = tabs.findIndex((t) => t.channelId === activeTabId);
        if (idx >= 0 && tabs.length > 1) {
          activeTabId = tabs[(idx - 1 + tabs.length) % tabs.length].channelId;
        }
      },
      onCloseTab: () => {
        if (activeTabId) handleCloseTab(activeTabId);
      },
      onReopenTab: handleReopenTab,
      onGoToTab: (index: number) => {
        if (index < tabs.length) activeTabId = tabs[index].channelId;
      },
    });
  });

  // session error listeners: register/unregister as ssh sessions come and go
  $effect(() => {
    const sshSessionIds = new Set(
      tabs
        .filter((t): t is TerminalTab & { backend: Extract<TabBackend, { kind: "ssh" }> } =>
          t.backend.kind === "ssh",
        )
        .map((t) => t.backend.sessionId),
    );

    for (const sid of sshSessionIds) {
      if (!sessionListeners.has(sid)) {
        onSessionError(sid, () => {
          lostSessions = new Set(lostSessions).add(sid);
        }).then((unlisten) => {
          sessionListeners.set(sid, unlisten);
        });
      }
    }

    for (const [sid, unlisten] of sessionListeners) {
      if (!sshSessionIds.has(sid)) {
        unlisten();
        sessionListeners.delete(sid);
      }
    }
  });

  // stats polling: follows the active tab's backend. keyed on activeTabId + lostSessions
  // only (not tabs), so a title change mid-session doesn't reset the readout.
  $effect(() => {
    activeTabId;
    lostSessions;
    const tab = untrack(() => activeTab);
    if (!tab) return;

    const pollStats = async () => {
      if (statsInFlight) return;
      statsInFlight = true;
      try {
        let sysStats: SystemStats;
        if (
          (tab.backend.kind === "ssh" || tab.backend.kind === "editor") &&
          !lostSessions.has(tab.backend.sessionId)
        ) {
          sysStats = await fetchSystemStats(tab.backend.sessionId);
        } else {
          sysStats = await fetchLocalStats();
        }
        prevStats = stats;
        stats = sysStats;
      } catch {
        // shrug, try again next cycle
      } finally {
        statsInFlight = false;
      }
    };

    // reset stats when switching tabs so stale data doesn't linger
    stats = null;
    prevStats = null;
    pollStats();
    const interval = setInterval(pollStats, STATS_POLL_MS);
    return () => clearInterval(interval);
  });
</script>

<div class="main-view">
  <TopBar
    hostname={activeHostname}
    {connectionStatus}
    latency={activeLatency}
    searchActive={searchVisible}
    onSearchToggle={() => (searchVisible = !searchVisible)}
    onDisconnect={handleDisconnect}
    {filesAvailable}
    filesActive={filesVisible}
    onFilesToggle={() => (filesVisible = !filesVisible)}
  />
  <TabBar
    {tabs}
    {activeTabId}
    {dirtyTabs}
    {profiles}
    onSelectTab={(id) => (activeTabId = id)}
    onCloseTab={handleCloseTab}
    onNewTab={handleNewTab}
    onNewSshTab={createSshTabFromProfile}
    onNewLocalTab={createLocalTab}
    {localShells}
    onReorderTabs={handleReorderTabs}
  />
  <div class="work-area">
    {#if filesVisible && activeSessionId && !isActiveLost}
      <FileBrowser
        sessionId={activeSessionId}
        onClose={() => (filesVisible = false)}
        onOpenFile={openEditorTab}
      />
    {/if}
    <div class="terminal-area">
    {#if TerminalPanel}
      {#each tabs as tab (tab.channelId)}
        {#if tab.backend.kind === "editor"}
          {#if EditorPanel}
            <EditorPanel
              channelId={tab.channelId}
              sessionId={tab.backend.sessionId}
              path={tab.backend.path}
              active={tab.channelId === activeTabId}
              onDirtyChange={setEditorDirty}
            />
          {:else}
            <div class="terminal-loading">OPENING EDITOR...</div>
          {/if}
        {:else}
          <TerminalPanel
            channelId={tab.channelId}
            active={tab.channelId === activeTabId}
            searchVisible={searchVisible && tab.channelId === activeTabId}
            onSearchToggle={() => (searchVisible = !searchVisible)}
            onClosed={() => handleCloseTab(tab.channelId)}
            onTitleChange={(title) => handleTabTitleChange(tab.channelId, title)}
          />
        {/if}
      {/each}
    {:else}
      <div class="terminal-loading">ALLOCATING PTY...</div>
    {/if}
    {#if connectionStatus === "lost"}
      <div class="link-lost-overlay">
        <div class="link-lost-panel">
          <div class="link-lost-icon">⚠</div>
          <div class="link-lost-title">LINK LOST</div>
          <div class="link-lost-sub">Connection to target terminated unexpectedly</div>
          <div class="link-lost-actions">
            <button class="btn btn-primary" onclick={handleReconnect} disabled={reconnecting}>
              {reconnecting ? "RECONNECTING..." : "RECONNECT"}
            </button>
            <button class="btn btn-danger" onclick={handleDisconnect}>
              DISCONNECT
            </button>
          </div>
        </div>
      </div>
    {/if}
    </div>
  </div>
  <StatusBar {stats} {prevStats} pollIntervalMs={STATS_POLL_MS} />
</div>

<style>
  .main-view {
    display: flex;
    flex-direction: column;
    height: 100%;
    width: 100%;
  }

  /* the file browser and terminal sit side by side. no bg - keep the glass chain
     intact (see below). */
  .work-area {
    flex: 1;
    min-height: 0;
    display: flex;
  }

  /* no bg here - the win11 acrylic has to reach the terminal canvas, and the
     terminal's own translucent theme bg does the frosting. paint anything opaque
     in this chain and the glass bricks up behind it. */
  .terminal-area {
    flex: 1;
    min-width: 0;
    min-height: 0;
    position: relative;
  }

  .terminal-loading {
    height: 100%;
    display: grid;
    place-items: center;
    color: var(--accent-primary);
    font-size: 0.72rem;
    font-weight: 700;
    letter-spacing: 0.14em;
  }

  /* ---- link lost ---- */

  .link-lost-overlay {
    position: absolute;
    inset: 0;
    z-index: 100;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(8, 8, 16, 0.85);
    backdrop-filter: blur(4px);
    animation: fade-in 0.3s ease-out;
  }

  .link-lost-panel {
    text-align: center;
    padding: 2rem 3rem;
    border: 1px solid rgba(232, 37, 78, 0.4);
    background: rgba(16, 14, 28, 0.95);
    clip-path: polygon(
      0 0,
      calc(100% - 12px) 0,
      100% 12px,
      100% 100%,
      12px 100%,
      0 calc(100% - 12px)
    );
  }

  .link-lost-icon {
    font-size: 2.5rem;
    color: var(--accent-secondary);
    margin-bottom: 0.5rem;
    text-shadow: 0 0 16px rgba(232, 37, 78, 0.6);
  }

  .link-lost-title {
    font-size: 1.2rem;
    font-weight: 700;
    letter-spacing: 0.2em;
    color: var(--accent-secondary);
    margin-bottom: 0.5rem;
  }

  .link-lost-sub {
    font-size: 0.75rem;
    color: var(--text-dim);
    margin-bottom: 1.5rem;
  }

  .link-lost-actions {
    display: flex;
    gap: 0.75rem;
    justify-content: center;
  }

  .link-lost-actions .btn {
    width: auto;
    padding: 0.5rem 1.5rem;
    font-family: inherit;
    font-size: 0.75rem;
    font-weight: 600;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    border: 1px solid;
    cursor: pointer;
    transition: all 0.15s ease;
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

  .link-lost-actions .btn-primary {
    color: var(--accent-primary);
    border-color: var(--accent-primary);
  }

  .link-lost-actions .btn-primary:hover:not(:disabled) {
    background: rgba(var(--accent-rgb), 0.08);
    box-shadow: 0 0 12px rgba(var(--accent-rgb), 0.15);
  }

  .link-lost-actions .btn-primary:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .link-lost-actions .btn-danger {
    color: var(--accent-secondary);
    border-color: rgba(232, 37, 78, 0.4);
  }

  .link-lost-actions .btn-danger:hover {
    background: rgba(232, 37, 78, 0.08);
    border-color: var(--accent-secondary);
  }

  @keyframes fade-in {
    from { opacity: 0; }
    to { opacity: 1; }
  }
</style>
