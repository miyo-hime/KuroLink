import { useState, useEffect, useRef } from "react";
import type { ConnectionStatus, MainMode } from "../lib/types";
import "./TopBar.css";

interface Props {
  hostname: string;
  connectionStatus: ConnectionStatus;
  latency: number | null;
  mode: MainMode;
  onModeChange: (mode: MainMode) => void;
  onDisconnect: () => void;
}

function latencyClass(ms: number): string {
  if (ms < 50) return "latency-good";
  if (ms < 150) return "latency-warn";
  return "latency-bad";
}

function statusIndicator(status: ConnectionStatus) {
  switch (status) {
    case "connected":
      return { className: "indicator-green indicator-pulse", label: "connected" };
    case "degraded":
      return { className: "indicator-warning indicator-pulse", label: "unstable" };
    case "lost":
      return { className: "indicator-red", label: "link lost" };
  }
}

export default function TopBar({ hostname, connectionStatus, latency, mode, onModeChange, onDisconnect }: Props) {
  const { className: indicatorClass, label: statusLabel } = statusIndicator(connectionStatus);
  const [confirming, setConfirming] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (confirming) {
      timerRef.current = setTimeout(() => setConfirming(false), 5000);
    }
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [confirming]);

  return (
    <div className="top-bar">
      <div className="top-bar-left">
        <span className="top-bar-label">TARGET</span>
        <span className="top-bar-host">{hostname}</span>
        <span className={`indicator-diamond ${indicatorClass}`} />
        <span className={`top-bar-status ${connectionStatus !== "connected" ? "status-warn" : ""}`}>
          {statusLabel}
        </span>
        {latency != null && connectionStatus === "connected" && (
          <span className={`top-bar-latency ${latencyClass(latency)}`}>{latency}ms</span>
        )}
      </div>
      <div className="top-bar-right">
        <button
          className={`mode-btn ${mode === "cli" ? "mode-active" : ""}`}
          onClick={() => onModeChange("cli")}
        >
          CLI
        </button>
        <button
          className={`mode-btn ${mode === "de" ? "mode-active" : "mode-locked"}`}
          disabled
          title="Phase 2"
        >
          DE
        </button>
        {confirming ? (
          <div className="disconnect-confirm">
            <span className="disconnect-confirm-label">TERMINATE LINK?</span>
            <button
              className="disconnect-confirm-btn confirm-yes"
              onClick={() => { setConfirming(false); onDisconnect(); }}
            >
              YES
            </button>
            <button
              className="disconnect-confirm-btn confirm-no"
              onClick={() => setConfirming(false)}
            >
              NO
            </button>
          </div>
        ) : (
          <button className="disconnect-btn" onClick={() => setConfirming(true)}>
            ✕
          </button>
        )}
      </div>
    </div>
  );
}
