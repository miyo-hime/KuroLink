import { useEffect, useState, useCallback, useRef } from "react";
import type { ConnectionProfile, TerminalTab, SystemStats } from "../lib/types";
import {
  openShell,
  closeShell,
  disconnectSsh,
  pingSession,
  fetchSystemStats,
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
}

const STATS_POLL_MS = 10_000;

export default function MainView({ sessionId, profile, onDisconnected }: Props) {
  const [tabs, setTabs] = useState<TerminalTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [latency, setLatency] = useState<number | null>(null);
  const [stats, setStats] = useState<SystemStats | null>(null);
  const prevStatsRef = useRef<SystemStats | null>(null);
  const tabCountRef = useRef(0);
  const mountedRef = useRef(false);

  // Open first terminal on mount (guard against StrictMode double-fire)
  useEffect(() => {
    if (mountedRef.current) return;
    mountedRef.current = true;
    createNewTab();

    // Fetch stats immediately, then poll
    const pollStats = async () => {
      try {
        const [ping, sysStats] = await Promise.all([
          pingSession(sessionId).catch(() => null),
          fetchSystemStats(sessionId).catch(() => null),
        ]);
        if (ping != null) setLatency(ping);
        if (sysStats) {
          setStats((prev) => {
            prevStatsRef.current = prev;
            return sysStats;
          });
        }
      } catch {
        // Session might be gone
      }
    };

    pollStats();
    const interval = setInterval(pollStats, STATS_POLL_MS);

    return () => clearInterval(interval);
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
        // If we closed the active tab, switch to the last remaining
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

  const handleTerminalClosed = useCallback(
    (channelId: string) => {
      handleCloseTab(channelId);
    },
    [handleCloseTab],
  );

  return (
    <div className="main-view">
      <TopBar
        hostname={profile.name || profile.host}
        connected={true}
        latency={latency}
        onDisconnect={handleDisconnect}
      />
      <TabBar
        tabs={tabs}
        activeTabId={activeTabId}
        onSelectTab={setActiveTabId}
        onCloseTab={handleCloseTab}
        onNewTab={createNewTab}
      />
      <div className="terminal-area">
        {tabs.map((tab) => (
          <TerminalPanel
            key={tab.channelId}
            sessionId={sessionId}
            channelId={tab.channelId}
            active={tab.channelId === activeTabId}
            onClosed={() => handleTerminalClosed(tab.channelId)}
          />
        ))}
      </div>
      <StatusBar
        stats={stats}
        prevStats={prevStatsRef.current}
        pollIntervalMs={STATS_POLL_MS}
      />
    </div>
  );
}
