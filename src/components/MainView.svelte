<script lang="ts">
  import { onMount, untrack } from "svelte";
  import { DEFAULT_LOCAL_SHELLS } from "../lib/types";
  import type { ConnectionProfile, Pane, PaneNode, Tab, SystemStats, ConnectionStatus, TabBackend, LocalShellId, LocalShellInfo, SavedSession, SavedTab, SavedPane, SavedTabEntry } from "../lib/types";
  import { leafOf, panesOf, findPane, mapPanes, splitAt, graftAt, removePane, setRatio, type GraftSide } from "../lib/paneTree";
  import { attachCommandKeys } from "../lib/shortcuts";
  import { commands, type Command } from "../lib/commands.svelte";
  import { appearance } from "../lib/appearance.svelte";
  import {
    openShell,
    openSshShell,
    openLocalShell,
    ensureSshSession,
    closeShell,
    disconnectSsh,
    fetchSystemStats,
    fetchLocalStats,
    detectLocalShells,
    getProfiles,
    saveSession,
    onSessionError,
    tearOffTab,
  } from "../lib/ipc";
  import type { UnlistenFn } from "@tauri-apps/api/event";
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import TopBar from "./TopBar.svelte";
  import TabBar from "./TabBar.svelte";
  import StatusBar from "./StatusBar.svelte";
  import FileBrowser from "./FileBrowser.svelte";
  import TransferTray from "./TransferTray.svelte";
  import CommandPalette from "./CommandPalette.svelte";
  import PaneTree from "./PaneTree.svelte";
  import { transfers } from "../lib/transfers.svelte";

  interface Props {
    initialSessionId: string | null;
    initialProfile: ConnectionProfile | null;
    initialLocalShell: LocalShellId | null;
    initialCwd: string | null;
    initialRestore: SavedSession | null;
    initialAdopt: Tab | null;
    onDisconnected: () => void;
  }

  let { initialSessionId, initialProfile, initialLocalShell, initialCwd, initialRestore, initialAdopt, onDisconnected }: Props = $props();

  const STATS_POLL_MS = 10_000;

  // torn-off windows are secondary: they don't own persisted session/geometry (one
  // shared config file, main wins), and they close their own shells on exit.
  const isMainWindow = getCurrentWindow().label === "main";

  // ghostty chunk is heavy (inlined wasm), so the panel stays its own lazy import -
  // the connect screen never pays for it
  let TerminalPanel = $state<typeof import("./TerminalPanel.svelte")["default"] | null>(null);
  // codemirror rides this chunk; only pull it the first time a file actually opens, so
  // a pure-terminal session never pays for the editor
  let EditorPanel = $state<typeof import("./EditorPanel.svelte")["default"] | null>(null);

  function ensureEditorPanel() {
    if (!EditorPanel) import("./EditorPanel.svelte").then((m) => (EditorPanel = m.default));
  }

  let tabs = $state<Tab[]>([]);
  let activeTabId = $state<string | null>(null);
  let stats = $state<SystemStats | null>(null);
  let prevStats = $state<SystemStats | null>(null);
  let searchVisible = $state(false);
  let filesVisible = $state(false);
  // editor dirty state lives OUTSIDE the tree on purpose - writing it into a pane
  // would rebuild `tabs` on every keystroke and yank focus out of the textarea.
  // keyed by the editor pane's paneId.
  let dirtyTabs = $state<Set<string>>(new Set());
  let lostSessions = $state<Set<string>>(new Set());
  let reconnecting = $state(false);
  let profiles = $state<ConnectionProfile[]>([]);
  let localShells = $state<LocalShellInfo[]>(DEFAULT_LOCAL_SHELLS);
  // which pane is showing a drag-to-split landing zone, and on which edge. lifted out of
  // PaneTree so moving across panes doesn't leave stale highlights on the ones you left.
  let paneDropHint = $state<{ paneId: string; side: GraftSide } | null>(null);

  let tabCount = 0;
  let sessionListeners = new Map<string, UnlistenFn>();
  let closedPaneStack: Pane[] = [];
  let statsInFlight = false;
  let titleTimers = new Map<string, ReturnType<typeof setTimeout>>();

  function allPanes(): Pane[] {
    return tabs.flatMap((t) => panesOf(t.layout));
  }

  // active pane = the showing tab's focused pane. stats, topbar, files all follow it.
  let activeTab = $derived(tabs.find((t) => t.id === activeTabId));
  let activePane = $derived(activeTab ? findPane(activeTab.layout, activeTab.activePaneId) : null);
  let activeSessionId = $derived(
    activePane && (activePane.backend.kind === "ssh" || activePane.backend.kind === "editor")
      ? activePane.backend.sessionId
      : null,
  );
  let activeHostname = $derived(
    activePane?.backend.kind === "ssh"
      ? activePane.backend.profileName
      : activePane?.backend.kind === "editor"
        ? basename(activePane.backend.path)
        : activePane?.backend.kind === "local"
          ? activePane.backend.shellType.toUpperCase()
          : "",
  );
  let isActiveLost = $derived(activeSessionId ? lostSessions.has(activeSessionId) : false);
  let connectionStatus = $derived<ConnectionStatus>(isActiveLost ? "lost" : "connected");
  let activeLatency = $derived(
    (activePane?.backend.kind === "ssh" || activePane?.backend.kind === "editor") && stats
      ? stats.latency_ms
      : null,
  );
  // sftp needs a live ssh session - local panes and dead links don't get the panel
  let filesAvailable = $derived(activeSessionId != null && !isActiveLost);

  // a pane's host color, if its profile carries one - local + profile-less panes get none
  function paneHostColor(pane: Pane): string | null {
    const b = pane.backend;
    const pid = b.kind === "ssh" || b.kind === "editor" ? b.profileId : null;
    return (pid && profiles.find((p) => p.id === pid)?.accent_rgb) || null;
  }

  // first time a live ssh session lands in focus, swing the browser open - if you're
  // on a remote box you almost certainly want its fs in view. once only (plain flag,
  // not $state), so closing it sticks and reconnects/pane-hops don't keep re-popping it.
  let hasAutoOpenedFiles = false;
  $effect(() => {
    if (filesAvailable && !hasAutoOpenedFiles) {
      hasAutoOpenedFiles = true;
      filesVisible = true;
    }
  });

  function basename(p: string): string {
    const i = p.lastIndexOf("/");
    return i < 0 ? p : p.slice(i + 1);
  }

  function profileLabel(profileId: string): string {
    const p = profiles.find((p) => p.id === profileId);
    return p?.name || p?.host || "SSH";
  }

  function addTab(pane: Pane) {
    const tab: Tab = { id: `tab:${crypto.randomUUID()}`, layout: leafOf(pane), activePaneId: pane.paneId };
    tabs = [...tabs, tab];
    activeTabId = tab.id;
  }

  // open a shell on an existing ssh session (used for the initial tab)
  async function createSshTabFromSession(sessionId: string, profile: ConnectionProfile) {
    try {
      const channelId = await openShell(sessionId, 80, 24);
      tabCount += 1;
      const name = profile.name || profile.host;
      addTab({ paneId: channelId, title: `${name} ${tabCount}`, backend: { kind: "ssh", sessionId, profileId: profile.id, profileName: name } });
    } catch (e) {
      console.error("failed to open shell:", e);
    }
  }

  async function createLocalTab(shellType: LocalShellId, cwd: string | null = null) {
    try {
      const channelId = await openLocalShell(shellType, 80, 24, cwd);
      tabCount += 1;
      addTab({ paneId: channelId, title: `${shellType} ${tabCount}`, backend: { kind: "local", shellType } });
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
      addTab({ paneId: result.channel_id, title: `${name} ${tabCount}`, backend: { kind: "ssh", sessionId: result.session_id, profileId, profileName: name } });
    } catch (e) {
      console.error("failed to open ssh shell:", e);
    }
  }

  // editor panes carry their own profileId, so this still resolves after the last shell closes.
  function profileForSession(sessionId: string): string | null {
    for (const p of allPanes()) {
      if (p.backend.kind === "ssh" && p.backend.sessionId === sessionId) return p.backend.profileId;
      if (p.backend.kind === "editor" && p.backend.sessionId === sessionId && p.backend.profileId)
        return p.backend.profileId;
    }
    return null;
  }

  // open a remote file in an editor tab (or focus it if already open). profileId is
  // derived from the session unless the caller already knows it (restore does)
  function openEditorTab(sessionId: string, path: string, profileId?: string | null) {
    ensureEditorPanel();
    for (const t of tabs) {
      const existing = panesOf(t.layout).find(
        (p) => p.backend.kind === "editor" && p.backend.sessionId === sessionId && p.backend.path === path,
      );
      if (existing) {
        activeTabId = t.id;
        tabs = tabs.map((x) => (x.id === t.id ? { ...x, activePaneId: existing.paneId } : x));
        return;
      }
    }
    const pid = profileId ?? profileForSession(sessionId);
    const paneId = `editor:${crypto.randomUUID()}`;
    addTab({ paneId, title: basename(path), backend: { kind: "editor", sessionId, profileId: pid, path } });
  }

  // right-click "Open to the Side / Below" grafts off the active pane; same path the
  // drag-drop takes, just with the side picked by the menu instead of the cursor.
  function openFileSplit(sessionId: string, path: string, dir: "h" | "v") {
    if (!activeTab) return;
    openFileAtPane(sessionId, path, activeTab.activePaneId, dir === "v" ? "right" : "bottom");
  }

  // drop a file from the browser onto a specific pane: open it as an editor grafted on
  // that pane's chosen edge. de-dupes within the target tab - already open here? focus it.
  function openFileAtPane(sessionId: string, path: string, targetPaneId: string, side: GraftSide) {
    ensureEditorPanel();
    const tab = tabs.find((t) => panesOf(t.layout).some((p) => p.paneId === targetPaneId));
    if (!tab) return;
    const existing = panesOf(tab.layout).find(
      (p) => p.backend.kind === "editor" && p.backend.sessionId === sessionId && p.backend.path === path,
    );
    if (existing) {
      activeTabId = tab.id;
      tabs = tabs.map((t) => (t.id === tab.id ? { ...t, activePaneId: existing.paneId } : t));
      return;
    }
    const paneId = `editor:${crypto.randomUUID()}`;
    const editor: Pane = { paneId, title: basename(path), backend: { kind: "editor", sessionId, profileId: profileForSession(sessionId), path } };
    const layout = graftAt(tab.layout, targetPaneId, side, leafOf(editor));
    tabs = tabs.map((t) => (t.id === tab.id ? { ...t, layout, activePaneId: paneId } : t));
    activeTabId = tab.id;
  }

  // an editor has no pty to clone, so a split off one drops a shell on its host: borrow
  // a sibling ssh session, falling back to the profileId baked on the editor itself.
  async function makeSiblingPane(pane: Pane): Promise<Pane | null> {
    if (pane.backend.kind === "local") {
      const shellType = pane.backend.shellType;
      try {
        const channelId = await openLocalShell(shellType, 80, 24);
        tabCount += 1;
        return { paneId: channelId, title: `${shellType} ${tabCount}`, backend: { kind: "local", shellType } };
      } catch (e) {
        console.error("failed to open local shell:", e);
        return null;
      }
    }

    const sessionId = pane.backend.sessionId;
    let info: { profileId: string; profileName: string } | null =
      pane.backend.kind === "ssh"
        ? { profileId: pane.backend.profileId, profileName: pane.backend.profileName }
        : null;
    if (!info) {
      const sib = allPanes().find((p) => p.backend.kind === "ssh" && p.backend.sessionId === sessionId);
      if (sib && sib.backend.kind === "ssh") info = { profileId: sib.backend.profileId, profileName: sib.backend.profileName };
    }
    if (!info && pane.backend.kind === "editor" && pane.backend.profileId) {
      info = { profileId: pane.backend.profileId, profileName: profileLabel(pane.backend.profileId) };
    }
    if (!info) return null;

    try {
      const channelId = await openShell(sessionId, 80, 24);
      tabCount += 1;
      return { paneId: channelId, title: `${info.profileName} ${tabCount}`, backend: { kind: "ssh", sessionId, profileId: info.profileId, profileName: info.profileName } };
    } catch (e) {
      console.error("failed to open shell:", e);
      return null;
    }
  }

  async function handleNewTab() {
    if (!activePane) return;
    const pane = await makeSiblingPane(activePane);
    if (pane) addTab(pane);
  }

  async function splitActivePane(dir: "h" | "v") {
    const tab = activeTab;
    const pane = activePane;
    if (!tab || !pane) return;
    const sibling = await makeSiblingPane(pane);
    if (!sibling) return;
    const layout = splitAt(tab.layout, pane.paneId, dir, sibling);
    tabs = tabs.map((t) => (t.id === tab.id ? { ...t, layout, activePaneId: sibling.paneId } : t));
  }

  function focusPane(tabId: string, paneId: string) {
    const cur = tabs.find((t) => t.id === tabId);
    if (activeTabId === tabId && cur?.activePaneId === paneId) return;
    activeTabId = tabId;
    tabs = tabs.map((t) => (t.id === tabId ? { ...t, activePaneId: paneId } : t));
  }

  function setTabRatio(tabId: string, splitId: string, ratio: number) {
    tabs = tabs.map((t) => (t.id === tabId ? { ...t, layout: setRatio(t.layout, splitId, ratio) } : t));
  }

  // nearest-pane-center in the pressed direction, geometry read off the DOM - so
  // arbitrary nesting never needs special-casing.
  function focusDir(dir: "left" | "right" | "up" | "down") {
    const tab = activeTab;
    if (!tab) return;
    const ids = new Set(panesOf(tab.layout).map((p) => p.paneId));
    const els = Array.from(document.querySelectorAll<HTMLElement>("[data-pane-id]")).filter(
      (e) => e.dataset.paneId && ids.has(e.dataset.paneId),
    );
    const cur = els.find((e) => e.dataset.paneId === tab.activePaneId);
    if (!cur) return;
    const cr = cur.getBoundingClientRect();
    const cx = cr.left + cr.width / 2;
    const cy = cr.top + cr.height / 2;

    let best: string | null = null;
    let bestDist = Infinity;
    for (const e of els) {
      const pid = e.dataset.paneId!;
      if (pid === tab.activePaneId) continue;
      const r = e.getBoundingClientRect();
      const dx = r.left + r.width / 2 - cx;
      const dy = r.top + r.height / 2 - cy;
      if (dir === "left" && dx >= -1) continue;
      if (dir === "right" && dx <= 1) continue;
      if (dir === "up" && dy >= -1) continue;
      if (dir === "down" && dy <= 1) continue;
      const dist = dx * dx + dy * dy;
      if (dist < bestDist) {
        bestDist = dist;
        best = pid;
      }
    }
    if (best) focusPane(tab.id, best);
  }

  // when it's the last pane in its tab, the tab goes too.
  async function closePane(paneId: string) {
    const tab = tabs.find((t) => panesOf(t.layout).some((p) => p.paneId === paneId));
    if (!tab) return;
    const pane = findPane(tab.layout, paneId);
    if (pane) closedPaneStack.push(pane);

    if (pane && (pane.backend.kind === "ssh" || pane.backend.kind === "local")) {
      await closeShell(paneId).catch(() => {});
    } else if (dirtyTabs.has(paneId)) {
      const next = new Set(dirtyTabs);
      next.delete(paneId);
      dirtyTabs = next;
    }

    const layout = removePane(tab.layout, paneId);
    if (layout === null) {
      const remaining = tabs.filter((t) => t.id !== tab.id);
      tabs = remaining;
      if (activeTabId === tab.id && remaining.length > 0) activeTabId = remaining[remaining.length - 1].id;
      if (remaining.length === 0) handleDisconnect();
      return;
    }
    let activePaneId = tab.activePaneId;
    if (!findPane(layout, activePaneId)) activePaneId = panesOf(layout)[0].paneId;
    tabs = tabs.map((t) => (t.id === tab.id ? { ...t, layout, activePaneId } : t));
  }

  async function handleCloseTab(tabId: string) {
    const tab = tabs.find((t) => t.id === tabId);
    if (!tab) return;
    for (const p of panesOf(tab.layout)) {
      closedPaneStack.push(p);
      if (p.backend.kind === "ssh" || p.backend.kind === "local") {
        await closeShell(p.paneId).catch(() => {});
      } else if (dirtyTabs.has(p.paneId)) {
        const next = new Set(dirtyTabs);
        next.delete(p.paneId);
        dirtyTabs = next;
      }
    }
    const next = tabs.filter((t) => t.id !== tabId);
    if (tabId === activeTabId && next.length > 0) activeTabId = next[next.length - 1].id;
    tabs = next;
    if (next.length === 0) handleDisconnect();
  }

  function handleReorderTabs(fromIndex: number, toIndex: number) {
    const next = [...tabs];
    const [moved] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, moved);
    tabs = next;
  }

  // tear-off: hand a whole tab to a fresh window. the panes stay live (their PTYs are
  // process-global; the new window just re-subscribes by paneId), so this routes around
  // handleCloseTab the same way graftTab does - ferry the tree, don't kill the shells.
  // gated to >1 tab: tearing off a lone tab would just empty this window for nothing.
  async function tearOff(tabId: string, screenX?: number, screenY?: number) {
    if (tabs.length <= 1) return;
    const tab = tabs.find((t) => t.id === tabId);
    if (!tab) return;
    const win = getCurrentWindow();
    try {
      const size = await win.innerSize();
      let x: number;
      let y: number;
      if (screenX != null && screenY != null) {
        // drop point is in css px; the rust side wants physical
        const dpr = window.devicePixelRatio || 1;
        x = Math.round(screenX * dpr) - 80;
        y = Math.round(screenY * dpr) - 16;
      } else {
        const pos = await win.outerPosition();
        x = pos.x + 48;
        y = pos.y + 48;
      }
      await tearOffTab(tab, x, y, size.width, size.height);
    } catch (e) {
      console.error("tear-off failed:", e);
      return;
    }
    const next = tabs.filter((t) => t.id !== tabId);
    if (tabId === activeTabId) activeTabId = next[next.length - 1].id;
    tabs = next;
  }

  // drag-out plumbing: TabBar tells us a tab drag started (so the window-level dragend
  // can tear it off if it lands outside our bounds). the rect is the window's outer box
  // in physical px, grabbed at dragstart so dragend stays synchronous.
  let draggingTabId: string | null = null;
  let dragWindowRect: { x: number; y: number; w: number; h: number } | null = null;

  function onTabDragStart(tabId: string) {
    draggingTabId = tabId;
    const win = getCurrentWindow();
    Promise.all([win.outerPosition(), win.outerSize()])
      .then(([p, s]) => (dragWindowRect = { x: p.x, y: p.y, w: s.width, h: s.height }))
      .catch(() => (dragWindowRect = null));
  }

  // drop a dragged tab onto a pane: graft the dragged tab's whole layout in beside that
  // pane. a re-parent, not a teardown - the panes stay live, so we route around
  // handleCloseTab (which would kill the PTYs) and just pull the tree out by hand.
  function graftTab(sourceTabId: string, targetPaneId: string, side: GraftSide) {
    const source = tabs.find((t) => t.id === sourceTabId);
    const target = tabs.find((t) => panesOf(t.layout).some((p) => p.paneId === targetPaneId));
    if (!source || !target || source.id === target.id) return;
    const incoming = source.layout;
    const focus = source.activePaneId;
    tabs = tabs
      .filter((t) => t.id !== source.id)
      .map((t) => (t.id === target.id ? { ...t, layout: graftAt(t.layout, targetPaneId, side, incoming), activePaneId: focus } : t));
    activeTabId = target.id;
    paneDropHint = null;
    draggingTabId = null;
  }

  // windows shells set the title to full exe paths and command lines -
  // extract just the program name like windows terminal does
  function cleanLocalTitle(raw: string): string {
    let name = raw;
    if (/^[a-zA-Z]:\\/.test(name)) {
      name = name.split(/[/\\]/).pop() || name;
    } else {
      name = name.split(/\s+/)[0];
      if (name.includes("\\") || name.includes("/")) {
        name = name.split(/[/\\]/).pop() || name;
      }
    }
    return name.replace(/\.(exe|cmd|bat|com)$/i, "");
  }

  function updatePaneTitle(paneId: string, title: string) {
    tabs = tabs.map((t) => {
      if (!panesOf(t.layout).some((p) => p.paneId === paneId)) return t;
      const layout = mapPanes(t.layout, (p) => (p.paneId === paneId && p.title !== title ? { ...p, title } : p));
      return layout === t.layout ? t : { ...t, layout };
    });
  }

  function handlePaneTitleChange(paneId: string, title: string) {
    const pane = allPanes().find((p) => p.paneId === paneId);
    // ssh shells handle titles well, pass through; local titles get cleaned + throttled
    if (!pane || pane.backend.kind !== "local") {
      updatePaneTitle(paneId, title);
      return;
    }
    const cleaned = cleanLocalTitle(title);
    const existing = titleTimers.get(paneId);
    if (existing) clearTimeout(existing);
    titleTimers.set(
      paneId,
      setTimeout(() => {
        titleTimers.delete(paneId);
        updatePaneTitle(paneId, cleaned);
      }, 200),
    );
  }

  // editor panel tells us when its buffer diverges - tracked off to the side so the
  // tab strip can show a dot without disturbing the editor's DOM
  function setEditorDirty(paneId: string, dirty: boolean) {
    if (dirtyTabs.has(paneId) === dirty) return;
    const next = new Set(dirtyTabs);
    if (dirty) next.add(paneId);
    else next.delete(paneId);
    dirtyTabs = next;
  }

  async function handleDisconnect() {
    for (const p of allPanes()) {
      if (p.backend.kind === "ssh" || p.backend.kind === "local") await closeShell(p.paneId).catch(() => {});
    }
    const sshSessionIds = new Set(
      allPanes()
        .filter((p) => p.backend.kind === "ssh")
        .map((p) => (p.backend as Extract<TabBackend, { kind: "ssh" }>).sessionId),
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
      const sshPane = allPanes().find((p) => p.backend.kind === "ssh" && p.backend.sessionId === sid);
      if (!sshPane || sshPane.backend.kind !== "ssh") return;

      const result = await openSshShell(sshPane.backend.profileId, 80, 24);

      const cleared = new Set(lostSessions);
      cleared.delete(sid);
      lostSessions = cleared;

      // re-point editor panes onto the fresh session (they survive - their sessionId is
      // read at call time inside the editor, so swapping it won't re-fetch or stomp
      // unsaved edits), then drop the dead ssh panes. tabs that empty out are removed.
      const rebuilt: Tab[] = [];
      for (const t of tabs) {
        let layout = mapPanes(t.layout, (p) =>
          p.backend.kind === "editor" && p.backend.sessionId === sid
            ? { ...p, backend: { ...p.backend, sessionId: result.session_id } }
            : p,
        );
        let surviving = layout;
        for (const p of panesOf(layout)) {
          if (p.backend.kind === "ssh" && p.backend.sessionId === sid) {
            const pruned = removePane(surviving, p.paneId);
            if (pruned === null) {
              surviving = null as never;
              break;
            }
            surviving = pruned;
          }
        }
        if (surviving == null) continue;
        let activePaneId = t.activePaneId;
        if (!findPane(surviving, activePaneId)) activePaneId = panesOf(surviving)[0].paneId;
        rebuilt.push({ ...t, layout: surviving, activePaneId });
      }

      tabCount += 1;
      const freshPane: Pane = {
        paneId: result.channel_id,
        title: `${sshPane.backend.profileName} ${tabCount}`,
        backend: { kind: "ssh", sessionId: result.session_id, profileId: sshPane.backend.profileId, profileName: sshPane.backend.profileName },
      };
      const freshTab: Tab = { id: `tab:${crypto.randomUUID()}`, layout: leafOf(freshPane), activePaneId: freshPane.paneId };
      tabs = [...rebuilt, freshTab];
      activeTabId = freshTab.id;
    } catch (e) {
      console.error("reconnect failed:", e);
    } finally {
      reconnecting = false;
    }
  }

  async function handleReopenTab() {
    const last = closedPaneStack.pop();
    if (!last) return;
    if (last.backend.kind === "ssh") {
      await createSshTabFromProfile(last.backend.profileId);
    } else if (last.backend.kind === "editor") {
      openEditorTab(last.backend.sessionId, last.backend.path, last.backend.profileId);
    } else {
      await createLocalTab(last.backend.shellType);
    }
  }

  function nextTab() {
    const idx = tabs.findIndex((t) => t.id === activeTabId);
    if (idx >= 0 && tabs.length > 1) activeTabId = tabs[(idx + 1) % tabs.length].id;
  }

  function prevTab() {
    const idx = tabs.findIndex((t) => t.id === activeTabId);
    if (idx >= 0 && tabs.length > 1) activeTabId = tabs[(idx - 1 + tabs.length) % tabs.length].id;
  }

  function paneCount(tab: Tab): number {
    return panesOf(tab.layout).length;
  }

  // the whole bridge in one list. derived off live state so a lost link flips
  // "reconnect" on, a new profile shows up as its own jump-to op, etc. the palette
  // reads this; the key dispatcher matches chords against it. one source, two doors.
  function buildCommands(): Command[] {
    const multiPane = activeTab ? paneCount(activeTab) > 1 : false;
    const list: Command[] = [
      { id: "tab.new", title: "New Tab", group: "TABS", keywords: "open create terminal", run: handleNewTab },
      {
        id: "pane.split.v",
        title: "Split Right",
        group: "PANES",
        keywords: "split pane vertical side",
        chord: "Alt ⇧ =",
        enabled: activePane != null,
        match: (e) => e.altKey && e.shiftKey && e.code === "Equal",
        run: () => splitActivePane("v"),
      },
      {
        id: "pane.split.h",
        title: "Split Down",
        group: "PANES",
        keywords: "split pane horizontal stack",
        chord: "Alt ⇧ -",
        enabled: activePane != null,
        match: (e) => e.altKey && e.shiftKey && e.code === "Minus",
        run: () => splitActivePane("h"),
      },
      {
        id: "pane.close",
        title: multiPane ? "Close Pane" : "Close Tab",
        group: "PANES",
        keywords: "kill quit pane tab",
        chord: "Ctrl ⇧ W",
        enabled: activeTab?.activePaneId != null,
        match: (e) => e.ctrlKey && e.shiftKey && e.code === "KeyW",
        run: () => { if (activeTab) closePane(activeTab.activePaneId); },
      },
      {
        id: "pane.focus.left",
        title: "Focus Pane Left",
        group: "PANES",
        chord: "Alt ◄",
        enabled: multiPane,
        match: (e) => e.altKey && !e.ctrlKey && !e.shiftKey && e.code === "ArrowLeft",
        run: () => focusDir("left"),
      },
      {
        id: "pane.focus.right",
        title: "Focus Pane Right",
        group: "PANES",
        chord: "Alt ►",
        enabled: multiPane,
        match: (e) => e.altKey && !e.ctrlKey && !e.shiftKey && e.code === "ArrowRight",
        run: () => focusDir("right"),
      },
      {
        id: "pane.focus.up",
        title: "Focus Pane Up",
        group: "PANES",
        chord: "Alt ▲",
        enabled: multiPane,
        match: (e) => e.altKey && !e.ctrlKey && !e.shiftKey && e.code === "ArrowUp",
        run: () => focusDir("up"),
      },
      {
        id: "pane.focus.down",
        title: "Focus Pane Down",
        group: "PANES",
        chord: "Alt ▼",
        enabled: multiPane,
        match: (e) => e.altKey && !e.ctrlKey && !e.shiftKey && e.code === "ArrowDown",
        run: () => focusDir("down"),
      },
      {
        id: "tab.reopen",
        title: "Reopen Closed Pane",
        group: "TABS",
        keywords: "undo restore",
        chord: "Ctrl ⇧ T",
        match: (e) => e.ctrlKey && e.shiftKey && e.code === "KeyT",
        run: handleReopenTab,
      },
      {
        id: "tab.next",
        title: "Next Tab",
        group: "TABS",
        chord: "Ctrl Tab",
        enabled: tabs.length > 1,
        match: (e) => e.ctrlKey && !e.shiftKey && e.key === "Tab",
        run: nextTab,
      },
      {
        id: "tab.prev",
        title: "Previous Tab",
        group: "TABS",
        chord: "Ctrl ⇧ Tab",
        enabled: tabs.length > 1,
        match: (e) => e.ctrlKey && e.shiftKey && e.key === "Tab",
        run: prevTab,
      },
      {
        id: "view.files",
        title: filesVisible ? "Hide File Browser" : "Show File Browser",
        group: "VIEW",
        keywords: "sftp explorer files",
        enabled: filesAvailable,
        run: () => (filesVisible = !filesVisible),
      },
      {
        id: "view.search",
        title: searchVisible ? "Hide Find" : "Find in Terminal",
        group: "VIEW",
        keywords: "search grep",
        run: () => (searchVisible = !searchVisible),
      },
      {
        id: "view.settings",
        title: "Appearance Settings",
        group: "VIEW",
        keywords: "theme color font glass config preset",
        run: () => appearance.openSettings(),
      },
      {
        id: "session.reconnect",
        title: "Reconnect Link",
        group: "SESSION",
        keywords: "reconnect retry revive",
        enabled: isActiveLost && !reconnecting,
        run: handleReconnect,
      },
      {
        id: "session.disconnect",
        title: "Terminate Link",
        group: "SESSION",
        keywords: "disconnect quit exit close all",
        run: handleDisconnect,
      },
    ];

    for (const shell of localShells) {
      if (!shell.available) continue;
      list.push({
        id: `open.local.${shell.id}`,
        title: `Open ${shell.label}`,
        group: "NEW · LOCAL",
        keywords: "shell terminal local",
        run: () => createLocalTab(shell.id),
      });
    }

    for (const p of profiles) {
      list.push({
        id: `open.ssh.${p.id}`,
        title: `Connect ${p.name}`,
        group: "NEW · SSH",
        detail: p.host,
        keywords: `ssh remote ${p.host}`,
        run: () => createSshTabFromProfile(p.id),
      });
    }

    tabs.forEach((t, i) => {
      const head = findPane(t.layout, t.activePaneId);
      list.push({
        id: `goto.${t.id}`,
        title: head?.title ?? "Tab",
        group: "GO TO TAB",
        detail: String(i + 1),
        keywords: "switch jump focus",
        chord: i < 9 ? `Ctrl ${i + 1}` : undefined,
        enabled: t.id !== activeTabId,
        match: i < 9 ? (e) => e.ctrlKey && !e.shiftKey && !e.altKey && e.code === `Digit${i + 1}` : undefined,
        run: () => (activeTabId = t.id),
      });
    });

    return list;
  }

  $effect(() => {
    commands.set(buildCommands());
  });

  // sessions are stood back up per-profile (reused across panes on the same host); a
  // profile that can't auth silently drops the panes that needed it.
  async function restoreSession(saved: SavedSession) {
    profiles = await getProfiles().catch(() => []);
    const sessionFor = new Map<string, string>();

    const ensure = async (profileId: string): Promise<string | null> => {
      const cached = sessionFor.get(profileId);
      if (cached) return cached;
      try {
        const sid = await ensureSshSession(profileId);
        sessionFor.set(profileId, sid);
        return sid;
      } catch (e) {
        console.error("restore: couldn't reach", profileId, e);
        return null;
      }
    };

    const instantiate = async (st: SavedTab): Promise<Pane | null> => {
      if (st.kind === "local") {
        const channelId = await openLocalShell(st.shellType, 80, 24);
        tabCount += 1;
        return { paneId: channelId, title: `${st.shellType} ${tabCount}`, backend: { kind: "local", shellType: st.shellType } };
      }
      const sid = await ensure(st.profileId);
      if (!sid) return null;
      if (st.kind === "ssh") {
        const channelId = await openShell(sid, 80, 24);
        tabCount += 1;
        const name = profileLabel(st.profileId);
        return { paneId: channelId, title: `${name} ${tabCount}`, backend: { kind: "ssh", sessionId: sid, profileId: st.profileId, profileName: name } };
      }
      // a stale 'files' leaf from a 0.20.2 blob has no path - drop it, don't crash on basename
      if ((st as { kind: string }).kind !== "editor") return null;
      ensureEditorPanel();
      const paneId = `editor:${crypto.randomUUID()}`;
      return { paneId, title: basename(st.path), backend: { kind: "editor", sessionId: sid, profileId: st.profileId, path: st.path } };
    };

    // a leaf whose host won't auth just drops out; its split collapses into the sibling,
    // same shape removePane gives a live close.
    const buildPane = async (sp: SavedPane): Promise<PaneNode | null> => {
      if (sp.kind === "leaf") {
        const pane = await instantiate(sp.backend);
        return pane ? leafOf(pane) : null;
      }
      const a = await buildPane(sp.a);
      const b = await buildPane(sp.b);
      if (!a) return b;
      if (!b) return a;
      return { kind: "split", id: `split:${crypto.randomUUID()}`, dir: sp.dir, a, b, ratio: sp.ratio };
    };

    const built: Tab[] = [];
    let activeId: string | null = null;
    for (let i = 0; i < saved.tabs.length; i++) {
      const entry = saved.tabs[i];
      try {
        const layout = await buildPane(entry.layout);
        if (!layout) continue;
        const leaves = panesOf(layout);
        const active = leaves[Math.min(entry.activeLeaf, leaves.length - 1)] ?? leaves[0];
        const tab: Tab = { id: `tab:${crypto.randomUUID()}`, layout, activePaneId: active.paneId };
        built.push(tab);
        if (i === saved.activeIndex) activeId = tab.id;
      } catch (e) {
        console.error("restore: tab failed", entry, e);
      }
    }

    tabs = built;
    // every host fell over (nothing silently authable) - back to the connect screen
    if (tabs.length === 0) {
      onDisconnected();
      return;
    }
    activeTabId = activeId ?? tabs[0].id;
  }

  function toSavedTab(b: TabBackend): SavedTab | null {
    if (b.kind === "ssh") return { kind: "ssh", profileId: b.profileId };
    if (b.kind === "local") return { kind: "local", shellType: b.shellType };
    if (b.kind === "editor" && b.profileId) return { kind: "editor", profileId: b.profileId, path: b.path };
    return null; // editor with no known profile - nothing to restore it from
  }

  // a non-persistable leaf (editor with no profile) drops and its split collapses, so
  // the saved tree is always restorable - null only when the whole tab is unpersistable.
  function toSavedPane(node: PaneNode): SavedPane | null {
    if (node.kind === "leaf") {
      const st = toSavedTab(node.pane.backend);
      return st ? { kind: "leaf", backend: st } : null;
    }
    const a = toSavedPane(node.a);
    const b = toSavedPane(node.b);
    if (!a) return b;
    if (!b) return a;
    return { kind: "split", dir: node.dir, a, b, ratio: node.ratio };
  }

  // stash the live tab set (debounced) so next launch's RESUME has the whole layout back.
  // empty sets are skipped on purpose: a clean disconnect should leave the last real
  // session sitting there to resume, not wipe it.
  $effect(() => {
    const snapshot = tabs;
    const activeId = activeTabId;
    // only main persists - a torn window writing the shared blob would clobber it
    if (!isMainWindow || snapshot.length === 0) return;
    const timer = setTimeout(() => {
      const out: SavedTabEntry[] = [];
      let activeIndex = 0;
      for (const t of snapshot) {
        const layout = toSavedPane(t.layout);
        if (!layout) continue;
        // activeLeaf indexes the persistable leaves in the same in-order toSavedPane keeps
        const persist = panesOf(t.layout).filter((p) => toSavedTab(p.backend) !== null);
        const activeLeaf = Math.max(0, persist.findIndex((p) => p.paneId === t.activePaneId));
        if (t.id === activeId) activeIndex = out.length;
        out.push({ layout, activeLeaf });
      }
      if (out.length > 0) saveSession({ tabs: out, activeIndex }).catch(() => {});
    }, 600);
    return () => clearTimeout(timer);
  });

  onMount(() => {
    transfers.init();
    import("./TerminalPanel.svelte").then((m) => (TerminalPanel = m.default));

    if (initialAdopt) {
      // a torn-off tab arrives whole, panes already pointing at live channels - just drop it in
      if (panesOf(initialAdopt.layout).some((p) => p.backend.kind === "editor")) ensureEditorPanel();
      tabs = [initialAdopt];
      activeTabId = initialAdopt.id;
    } else if (initialRestore) {
      restoreSession(initialRestore);
    } else if (initialLocalShell) {
      createLocalTab(initialLocalShell, initialCwd);
    } else if (initialSessionId && initialProfile) {
      createSshTabFromSession(initialSessionId, initialProfile);
    }
    // seed the lookup so this host's tab/pane color shows on the first paint, before
    // the full profile list lands
    if (initialProfile) profiles = [initialProfile];
    getProfiles().then((p) => (profiles = p)).catch(() => {});
    detectLocalShells().then((s) => (localShells = s)).catch(() => {});

    const detachKeys = attachCommandKeys();
    // window-level dragend does double duty: clear a stranded split hint, and decide
    // whether a tab drag that ended outside our bounds means "tear off to a new window".
    const onDragEnd = (e: DragEvent) => {
      paneDropHint = null;
      const tabId = draggingTabId;
      const rect = dragWindowRect;
      draggingTabId = null;
      dragWindowRect = null;
      if (!tabId || !rect || tabs.length <= 1) return;
      const dpr = window.devicePixelRatio || 1;
      const px = e.screenX * dpr;
      const py = e.screenY * dpr;
      const outside = px < rect.x || px > rect.x + rect.w || py < rect.y || py > rect.y + rect.h;
      if (outside) tearOff(tabId, e.screenX, e.screenY);
    };
    window.addEventListener("dragend", onDragEnd);

    // a secondary window cleans up after itself: the main process keeps running, so its
    // shells would leak if we didn't close them as the window goes.
    let detachClose: (() => void) | undefined;
    if (!isMainWindow) {
      getCurrentWindow()
        .onCloseRequested(async (event) => {
          // a wedged ssh channel must not trap the window open - awaiting closeShell
          // straight is what made close need a manual session-kill first. fire them all,
          // race a deadline, tear down regardless. worst case a channel outlives the
          // window till app exit, which beats a window that won't close.
          event.preventDefault();
          const cleanup = Promise.allSettled(
            allPanes()
              .filter((p) => p.backend.kind === "ssh" || p.backend.kind === "local")
              .map((p) => closeShell(p.paneId)),
          );
          await Promise.race([cleanup, new Promise((r) => setTimeout(r, 500))]);
          await getCurrentWindow().destroy();
        })
        .then((fn) => (detachClose = fn))
        .catch(() => {});
    }

    return () => {
      detachKeys();
      commands.clear();
      window.removeEventListener("dragend", onDragEnd);
      detachClose?.();
    };
  });

  // session error listeners: register/unregister as ssh sessions come and go
  $effect(() => {
    const sshSessionIds = new Set(
      tabs
        .flatMap((t) => panesOf(t.layout))
        .filter((p) => p.backend.kind === "ssh")
        .map((p) => (p.backend as Extract<TabBackend, { kind: "ssh" }>).sessionId),
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

  // stats polling: follows the active pane's backend. keyed on the active pane id +
  // lostSessions only (not the whole tree), so a title change mid-session doesn't reset
  // the readout, but a pane hop or tab switch does.
  $effect(() => {
    activePane?.paneId;
    lostSessions;
    const pane = untrack(() => activePane);
    if (!pane) return;

    const pollStats = async () => {
      if (statsInFlight) return;
      statsInFlight = true;
      try {
        let sysStats: SystemStats;
        if (
          (pane.backend.kind === "ssh" || pane.backend.kind === "editor") &&
          !lostSessions.has(pane.backend.sessionId)
        ) {
          sysStats = await fetchSystemStats(pane.backend.sessionId);
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
    onOpenFile={openEditorTab}
    onTearOff={(id) => tearOff(id)}
    {onTabDragStart}
  />
  <div class="work-area">
    {#if filesVisible && activeSessionId && !isActiveLost}
      <FileBrowser
        sessionId={activeSessionId}
        onClose={() => (filesVisible = false)}
        onOpenFile={openEditorTab}
        onOpenSplit={openFileSplit}
      />
    {/if}
    <div class="terminal-area">
      {#snippet paneLeaf(pane: Pane, visible: boolean, focused: boolean, multiPane: boolean)}
        {#if pane.backend.kind === "editor"}
          {#if EditorPanel}
            <EditorPanel
              channelId={pane.paneId}
              sessionId={pane.backend.sessionId}
              path={pane.backend.path}
              {visible}
              {focused}
              canClose={multiPane}
              onDirtyChange={setEditorDirty}
              onClose={() => closePane(pane.paneId)}
            />
          {:else}
            <div class="terminal-loading">OPENING EDITOR...</div>
          {/if}
        {:else if TerminalPanel}
          <TerminalPanel
            channelId={pane.paneId}
            {visible}
            {focused}
            searchVisible={searchVisible && focused}
            onSearchToggle={() => (searchVisible = !searchVisible)}
            onClosed={() => closePane(pane.paneId)}
            onTitleChange={(title) => handlePaneTitleChange(pane.paneId, title)}
          />
        {:else}
          <div class="terminal-loading">ALLOCATING PTY...</div>
        {/if}
      {/snippet}

      {#each tabs as tab (tab.id)}
        <div class="tab-layer" class:tab-layer-hidden={tab.id !== activeTabId}>
          <PaneTree
            node={tab.layout}
            activePaneId={tab.activePaneId}
            tabVisible={tab.id === activeTabId}
            multiPane={panesOf(tab.layout).length > 1}
            dropHint={paneDropHint}
            paneColor={paneHostColor}
            onFocusPane={(pid) => focusPane(tab.id, pid)}
            onSetRatio={(sid, r) => setTabRatio(tab.id, sid, r)}
            onClosePane={closePane}
            onDropHint={(h) => (paneDropHint = h)}
            onGraftTab={graftTab}
            onOpenFilePane={openFileAtPane}
            leaf={paneLeaf}
          />
        </div>
      {/each}

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
  <TransferTray />
  <CommandPalette />
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

  /* one layer per tab, stacked. hidden tabs use visibility (not display:none) so their
     panes keep real geometry - a terminal stays correctly fitted while offscreen and
     doesn't have to reflow on every tab switch. */
  .tab-layer {
    position: absolute;
    inset: 0;
  }

  .tab-layer-hidden {
    visibility: hidden;
    pointer-events: none;
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
