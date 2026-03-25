import { useEffect, useState, useCallback, useRef } from "react";
import type { ConnectionProfile, TerminalTab, SystemStats, ConnectionStatus, MainMode } from "../lib/types";
import {
  openShell,
  closeShell,
  disconnectSsh,
  pingSession,
  fetchSystemStats,
  connectSsh,
  onSessionError,
} from "../lib/ipc";
import TopBar from "./TopBar";
import TabBar from "./TabBar";
import TerminalPanel from "./TerminalPanel";
import StatusBar from "./StatusBar";
import "./MainView.css";

interface Props {
  sessionId: string;
  profile: ConnectionProfile;
  onDisconnected: () => void;
  onSessionReconnected: (newSessionId: string) => void;
}

const STATS_POLL_MS = 10_000;
const FAIL_THRESHOLD = 3;

export default function MainView({ sessionId, profile, onDisconnected, onSessionReconnected }: Props) {
  const [tabs, setTabs] = useState<TerminalTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [latency, setLatency] = useState<number | null>(null);
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("connected");
  const [mode, setMode] = useState<MainMode>("cli");
  const [reconnecting, setReconnecting] = useState(false);
  const prevStatsRef = useRef<SystemStats | null>(null);
  const tabCountRef = useRef(0);
  const mountedRef = useRef(false);
  const failCountRef = useRef(0);

  // strictmode double-mount guard. prevents duplicate shell opens.
  // harmless in prod, revisit if we need legit remounts
  useEffect(() => {
    if (mountedRef.current) return;
    mountedRef.current = true;
    createNewTab();

    // session errors from backend
    const unlistenPromise = onSessionError(sessionId, (_msg) => {
      setConnectionStatus("lost");
    });

    // stats poll
    const pollStats = async () => {
      try {
        const [ping, sysStats] = await Promise.all([
          pingSession(sessionId).catch(() => null),
          fetchSystemStats(sessionId).catch(() => null),
        ]);
        if (ping != null) {
          setLatency(ping);
          failCountRef.current = 0;
          setConnectionStatus((prev) => prev === "degraded" ? "connected" : prev);
        } else {
          failCountRef.current++;
          if (failCountRef.current >= FAIL_THRESHOLD) {
            setConnectionStatus((prev) => prev === "connected" ? "degraded" : prev);
          }
        }
        if (sysStats) {
          setStats((prev) => {
            prevStatsRef.current = prev;
            return sysStats;
          });
        }
      } catch {
        // session might be gone
      }
    };

    pollStats();
    const interval = setInterval(pollStats, STATS_POLL_MS);

    return () => {
      clearInterval(interval);
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const createNewTab = useCallback(async () => {
    try {
      const channelId = await openShell(sessionId, 80, 24);
      tabCountRef.current += 1;
      const tab: TerminalTab = {
        channelId,
        title: `Terminal ${tabCountRef.current}`,
      };
      setTabs((prev) => [...prev, tab]);
      setActiveTabId(channelId);
    } catch (e) {
      console.error("Failed to open shell:", e);
    }
  }, [sessionId]);

  const handleCloseTab = useCallback(
    async (channelId: string) => {
      await closeShell(sessionId, channelId).catch(() => {});
      setTabs((prev) => {
        const next = prev.filter((t) => t.channelId !== channelId);
        // closed the active tab, switch to last one
        if (channelId === activeTabId && next.length > 0) {
          setActiveTabId(next[next.length - 1].channelId);
        }
        return next;
      });
    },
    [sessionId, activeTabId],
  );

  const handleDisconnect = useCallback(async () => {
    await disconnectSsh(sessionId).catch(() => {});
    onDisconnected();
  }, [sessionId, onDisconnected]);

  const handleReconnect = useCallback(async () => {
    setReconnecting(true);
    try {
      const newSessionId = await connectSsh(
        profile.id,
        profile.host,
        profile.port,
        profile.username,
        profile.key_path,
      );
      setConnectionStatus("connected");
      failCountRef.current = 0;
      onSessionReconnected(newSessionId);
    } catch (e) {
      console.error("Reconnect failed:", e);
    } finally {
      setReconnecting(false);
    }
  }, [profile, onSessionReconnected]);

  const handleTerminalClosed = useCallback(
    (channelId: string) => {
      handleCloseTab(channelId);
    },
    [handleCloseTab],
  );

  const handleTabTitleChange = useCallback(
    (channelId: string, title: string) => {
      setTabs((prev) =>
        prev.map((t) => (t.channelId === channelId ? { ...t, title } : t)),
      );
    },
    [],
  );

  return (
    <div className="main-view">
      <TopBar
        hostname={profile.name || profile.host}
        connectionStatus={connectionStatus}
        latency={latency}
        mode={mode}
        onModeChange={setMode}
        onDisconnect={handleDisconnect}
      />
      <div style={{ display: mode === "cli" ? "contents" : "none" }}>
        <TabBar
          tabs={tabs}
          activeTabId={activeTabId}
          onSelectTab={setActiveTabId}
          onCloseTab={handleCloseTab}
          onNewTab={createNewTab}
        />
      </div>
      <div className="terminal-area">
        <div style={{ display: mode === "cli" ? "contents" : "none" }}>
          {tabs.map((tab) => (
            <TerminalPanel
              key={tab.channelId}
              sessionId={sessionId}
              channelId={tab.channelId}
              active={tab.channelId === activeTabId && mode === "cli"}
              onClosed={() => handleTerminalClosed(tab.channelId)}
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
