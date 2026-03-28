import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import type { ConnectionProfile, TerminalTab, SystemStats, ConnectionStatus, MainMode, TabBackend } from "../lib/types";
import { useKeyboardShortcuts } from "../lib/useKeyboardShortcuts";
import {
  openShell,
  openSshShell,
  openLocalShell,
  closeShell,
  disconnectSsh,
  fetchSystemStats,
  fetchLocalStats,
  getProfiles,
  onSessionError,
} from "../lib/ipc";
import type { UnlistenFn } from "@tauri-apps/api/event";
import TopBar from "./TopBar";
import TabBar from "./TabBar";
import TerminalPanel from "./TerminalPanel";
import StatusBar from "./StatusBar";
import "./MainView.css";

interface Props {
  initialSessionId: string | null;
  initialProfile: ConnectionProfile | null;
  initialLocalShell: "powershell" | "cmd" | "wsl" | null;
  onDisconnected: () => void;
}

const STATS_POLL_MS = 10_000;

export default function MainView({ initialSessionId, initialProfile, initialLocalShell, onDisconnected }: Props) {
  const [tabs, setTabs] = useState<TerminalTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [mode, setMode] = useState<MainMode>("cli");
  const [searchVisible, setSearchVisible] = useState(false);
  const [lostSessions, setLostSessions] = useState<Set<string>>(new Set());
  const [reconnecting, setReconnecting] = useState(false);
  const [profiles, setProfiles] = useState<ConnectionProfile[]>([]);

  const prevStatsRef = useRef<SystemStats | null>(null);
  const tabCountRef = useRef(0);
  const mountedRef = useRef(false);
  const sessionListenersRef = useRef<Map<string, UnlistenFn>>(new Map());
  const closedTabStackRef = useRef<TerminalTab[]>([]);

  // derived state from active tab
  const activeTab = tabs.find((t) => t.channelId === activeTabId);
  const activeSessionId =
    activeTab?.backend.kind === "ssh" ? activeTab.backend.sessionId : null;
  const activeHostname =
    activeTab?.backend.kind === "ssh"
      ? activeTab.backend.profileName
      : activeTab?.backend.kind === "local"
        ? activeTab.backend.shellType.toUpperCase()
        : "";
  const isActiveLost = activeSessionId
    ? lostSessions.has(activeSessionId)
    : false;
  const connectionStatus: ConnectionStatus = isActiveLost ? "lost" : "connected";
  const activeLatency =
    activeTab?.backend.kind === "ssh" && stats ? stats.latency_ms : null;

  // -- mount: create first tab (ssh or local) + load profiles for dropdown --
  useEffect(() => {
    if (mountedRef.current) return;
    mountedRef.current = true;
    if (initialLocalShell) {
      createLocalTab(initialLocalShell);
    } else if (initialSessionId && initialProfile) {
      createSshTabFromSession(initialSessionId, initialProfile);
    }
    getProfiles().then(setProfiles).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // -- session error listeners: register/unregister as sessions come and go --
  useEffect(() => {
    const sshSessionIds = new Set(
      tabs
        .filter((t): t is TerminalTab & { backend: Extract<TabBackend, { kind: "ssh" }> } =>
          t.backend.kind === "ssh",
        )
        .map((t) => t.backend.sessionId),
    );

    // register new listeners
    for (const sid of sshSessionIds) {
      if (!sessionListenersRef.current.has(sid)) {
        onSessionError(sid, () => {
          setLostSessions((prev) => new Set(prev).add(sid));
        }).then((unlisten) => {
          sessionListenersRef.current.set(sid, unlisten);
        });
      }
    }

    // clean up listeners for sessions we no longer have tabs for
    for (const [sid, unlisten] of sessionListenersRef.current) {
      if (!sshSessionIds.has(sid)) {
        unlisten();
        sessionListenersRef.current.delete(sid);
      }
    }
  }, [tabs]);

  // -- stats polling: follows the active tab's backend --
  useEffect(() => {
    if (!activeTab) return;

    const pollStats = async () => {
      try {
        let sysStats: SystemStats;
        if (activeTab.backend.kind === "ssh" && !lostSessions.has(activeTab.backend.sessionId)) {
          sysStats = await fetchSystemStats(activeTab.backend.sessionId);
        } else {
          sysStats = await fetchLocalStats();
        }
        setStats((prev) => {
          prevStatsRef.current = prev;
          return sysStats;
        });
      } catch {
        // shrug, try again next cycle
      }
    };

    // reset stats when switching tabs so stale data doesn't linger
    setStats(null);
    prevStatsRef.current = null;
    pollStats();
    const interval = setInterval(pollStats, STATS_POLL_MS);
    return () => clearInterval(interval);
  }, [activeTabId, lostSessions]); // eslint-disable-line react-hooks/exhaustive-deps

  // -- tab creation --

  // open a shell on an existing ssh session (used for initial tab + "+" duplication)
  const createSshTabFromSession = async (
    sessionId: string,
    profile: ConnectionProfile,
  ) => {
    try {
      const channelId = await openShell(sessionId, 80, 24);
      tabCountRef.current += 1;
      const name = profile.name || profile.host;
      const tab: TerminalTab = {
        channelId,
        title: `${name} ${tabCountRef.current}`,
        backend: {
          kind: "ssh",
          sessionId,
          profileId: profile.id,
          profileName: name,
        },
      };
      setTabs((prev) => [...prev, tab]);
      setActiveTabId(channelId);
    } catch (e) {
      console.error("failed to open shell:", e);
    }
  };

  // open a local terminal tab
  const createLocalTab = useCallback(async (shellType: "powershell" | "cmd" | "wsl") => {
    try {
      const channelId = await openLocalShell(shellType, 80, 24);
      tabCountRef.current += 1;
      const tab: TerminalTab = {
        channelId,
        title: `${shellType} ${tabCountRef.current}`,
        backend: { kind: "local", shellType },
      };
      setTabs((prev) => [...prev, tab]);
      setActiveTabId(channelId);
    } catch (e) {
      console.error("failed to open local shell:", e);
    }
  }, []);

  // connect to a profile (new or reuse session) and open a tab - used by dropdown
  const createSshTabFromProfile = useCallback(async (profileId: string) => {
    try {
      const result = await openSshShell(profileId, 80, 24);
      tabCountRef.current += 1;
      const profile = profiles.find((p) => p.id === profileId);
      const name = profile?.name || profile?.host || "SSH";
      const tab: TerminalTab = {
        channelId: result.channel_id,
        title: `${name} ${tabCountRef.current}`,
        backend: {
          kind: "ssh",
          sessionId: result.session_id,
          profileId,
          profileName: name,
        },
      };
      setTabs((prev) => [...prev, tab]);
      setActiveTabId(result.channel_id);
    } catch (e) {
      console.error("failed to open ssh shell:", e);
    }
  }, [profiles]);

  // drag reorder
  const handleReorderTabs = useCallback((fromIndex: number, toIndex: number) => {
    setTabs((prev) => {
      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next;
    });
  }, []);

  // "+" button: clone the active tab's connection type
  const handleNewTab = useCallback(async () => {
    if (!activeTab) return;

    if (activeTab.backend.kind === "ssh") {
      const { sessionId, profileId, profileName } = activeTab.backend;
      try {
        const channelId = await openShell(sessionId, 80, 24);
        tabCountRef.current += 1;
        const tab: TerminalTab = {
          channelId,
          title: `${profileName} ${tabCountRef.current}`,
          backend: { kind: "ssh", sessionId, profileId, profileName },
        };
        setTabs((prev) => [...prev, tab]);
        setActiveTabId(channelId);
      } catch (e) {
        console.error("failed to open shell:", e);
      }
    } else {
      await createLocalTab(activeTab.backend.shellType);
    }
  }, [activeTab, createLocalTab]);

  // -- tab management --

  const handleCloseTab = useCallback(
    async (channelId: string) => {
      // save to closed stack for reopen (ctrl+shift+t)
      const closing = tabs.find((t) => t.channelId === channelId);
      if (closing) {
        closedTabStackRef.current.push(closing);
      }

      await closeShell(channelId).catch(() => {});
      setTabs((prev) => {
        const next = prev.filter((t) => t.channelId !== channelId);
        if (channelId === activeTabId && next.length > 0) {
          setActiveTabId(next[next.length - 1].channelId);
        }
        // if no tabs left, disconnect everything
        if (next.length === 0) {
          handleDisconnect();
        }
        return next;
      });
    },
    [activeTabId, tabs], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // windows shells set the title to full exe paths and command lines -
  // extract just the program name like windows terminal does
  const cleanLocalTitle = (raw: string): string => {
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
    // strip .exe/.cmd/.bat
    return name.replace(/\.(exe|cmd|bat|com)$/i, "");
  };

  // throttle local tab title updates (200ms) to prevent flicker from
  // rapid subprocess chains. same approach as windows terminal
  const titleTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const handleTabTitleChange = useCallback(
    (channelId: string, title: string) => {
      const applyTitle = (cleaned: string) => {
        setTabs((prev) =>
          prev.map((t) => (t.channelId === channelId ? { ...t, title: cleaned } : t)),
        );
      };

      // ssh tabs: pass through immediately, shells handle titles well
      const tab = tabs.find((t) => t.channelId === channelId);
      if (!tab || tab.backend.kind !== "local") {
        applyTitle(title);
        return;
      }

      // local tabs: clean + throttle
      const cleaned = cleanLocalTitle(title);
      const existing = titleTimersRef.current.get(channelId);
      if (existing) clearTimeout(existing);
      titleTimersRef.current.set(
        channelId,
        setTimeout(() => {
          titleTimersRef.current.delete(channelId);
          applyTitle(cleaned);
        }, 200),
      );
    },
    [tabs],
  );

  // -- disconnect all --

  const handleDisconnect = useCallback(async () => {
    // close all channels
    for (const tab of tabs) {
      await closeShell(tab.channelId).catch(() => {});
    }
    // disconnect ssh sessions
    const sshSessionIds = new Set(
      tabs
        .filter((t) => t.backend.kind === "ssh")
        .map((t) => (t.backend as Extract<TabBackend, { kind: "ssh" }>).sessionId),
    );
    for (const sid of sshSessionIds) {
      await disconnectSsh(sid).catch(() => {});
    }
    // clean up session listeners
    for (const [, unlisten] of sessionListenersRef.current) {
      unlisten();
    }
    sessionListenersRef.current.clear();
    onDisconnected();
  }, [tabs, onDisconnected]);

  // -- reconnect (when active session is lost) --

  const handleReconnect = useCallback(async () => {
    if (!activeSessionId) return;
    setReconnecting(true);
    try {
      // find a tab on this session to get profile info
      const sshTab = tabs.find(
        (t) => t.backend.kind === "ssh" && t.backend.sessionId === activeSessionId,
      );
      if (!sshTab || sshTab.backend.kind !== "ssh") return;

      const result = await openSshShell(sshTab.backend.profileId, 80, 24);

      // clear lost status for old session
      setLostSessions((prev) => {
        const next = new Set(prev);
        next.delete(activeSessionId);
        return next;
      });

      // remove dead tabs for the old session, add a fresh one
      tabCountRef.current += 1;
      const newTab: TerminalTab = {
        channelId: result.channel_id,
        title: `${sshTab.backend.profileName} ${tabCountRef.current}`,
        backend: {
          kind: "ssh",
          sessionId: result.session_id,
          profileId: sshTab.backend.profileId,
          profileName: sshTab.backend.profileName,
        },
      };
      setTabs((prev) => {
        const cleaned = prev.filter(
          (t) =>
            !(t.backend.kind === "ssh" && t.backend.sessionId === activeSessionId),
        );
        return [...cleaned, newTab];
      });
      setActiveTabId(result.channel_id);
    } catch (e) {
      console.error("reconnect failed:", e);
    } finally {
      setReconnecting(false);
    }
  }, [activeSessionId, tabs]);

  // -- keyboard shortcuts --

  const handleReopenTab = useCallback(async () => {
    const last = closedTabStackRef.current.pop();
    if (!last) return;

    // reopen based on backend type
    if (last.backend.kind === "ssh") {
      await createSshTabFromProfile(last.backend.profileId);
    } else {
      await createLocalTab(last.backend.shellType);
    }
  }, [createSshTabFromProfile, createLocalTab]);

  const shortcutHandlers = useMemo(
    () => ({
      onNextTab: () => {
        const idx = tabs.findIndex((t) => t.channelId === activeTabId);
        if (idx >= 0 && tabs.length > 1) {
          setActiveTabId(tabs[(idx + 1) % tabs.length].channelId);
        }
      },
      onPrevTab: () => {
        const idx = tabs.findIndex((t) => t.channelId === activeTabId);
        if (idx >= 0 && tabs.length > 1) {
          setActiveTabId(tabs[(idx - 1 + tabs.length) % tabs.length].channelId);
        }
      },
      onCloseTab: () => {
        if (activeTabId) handleCloseTab(activeTabId);
      },
      onReopenTab: handleReopenTab,
      onGoToTab: (index: number) => {
        if (index < tabs.length) {
          setActiveTabId(tabs[index].channelId);
        }
      },
    }),
    [tabs, activeTabId, handleCloseTab, handleReopenTab],
  );

  useKeyboardShortcuts(shortcutHandlers);

  return (
    <div className="main-view">
      <TopBar
        hostname={activeHostname}
        connectionStatus={connectionStatus}
        latency={activeLatency}
        mode={mode}
        searchActive={searchVisible}
        onModeChange={setMode}
        onSearchToggle={() => setSearchVisible((v) => !v)}
        onDisconnect={handleDisconnect}
      />
      <div style={{ display: mode === "cli" ? "contents" : "none" }}>
        <TabBar
          tabs={tabs}
          activeTabId={activeTabId}
          profiles={profiles}
          onSelectTab={setActiveTabId}
          onCloseTab={handleCloseTab}
          onNewTab={handleNewTab}
          onNewSshTab={createSshTabFromProfile}
          onNewLocalTab={createLocalTab}
          onReorderTabs={handleReorderTabs}
        />
      </div>
      <div className="terminal-area">
        <div style={{ display: mode === "cli" ? "contents" : "none" }}>
          {tabs.map((tab) => (
            <TerminalPanel
              key={tab.channelId}
              channelId={tab.channelId}
              active={tab.channelId === activeTabId && mode === "cli"}
              searchVisible={searchVisible && tab.channelId === activeTabId}
              onSearchToggle={() => setSearchVisible((v) => !v)}
              onClosed={() => handleCloseTab(tab.channelId)}
              onTitleChange={(title) => handleTabTitleChange(tab.channelId, title)}
            />
          ))}
        </div>
        {mode === "de" && (
          <div className="de-placeholder">
            <div className="de-placeholder-icon">&#9634;</div>
            <div className="de-placeholder-title">DESKTOP ENVIRONMENT</div>
            <div className="de-placeholder-sub">VNC integration - coming in phase 2</div>
          </div>
        )}
        {connectionStatus === "lost" && (
          <div className="link-lost-overlay">
            <div className="link-lost-panel">
              <div className="link-lost-icon">⚠</div>
              <div className="link-lost-title">LINK LOST</div>
              <div className="link-lost-sub">Connection to target terminated unexpectedly</div>
              <div className="link-lost-actions">
                <button
                  className="btn btn-primary"
                  onClick={handleReconnect}
                  disabled={reconnecting}
                >
                  {reconnecting ? "RECONNECTING..." : "RECONNECT"}
                </button>
                <button className="btn btn-danger" onClick={handleDisconnect}>
                  DISCONNECT
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
      <StatusBar
        stats={stats}
        prevStats={prevStatsRef.current}
        pollIntervalMs={STATS_POLL_MS}
      />
    </div>
  );
}
