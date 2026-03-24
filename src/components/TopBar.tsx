import "./TopBar.css";

interface Props {
  hostname: string;
  connected: boolean;
  latency: number | null;
  onDisconnect: () => void;
}

export default function TopBar({ hostname, connected, latency, onDisconnect }: Props) {
  return (
    <div className="top-bar">
      <div className="top-bar-left">
        <span className="top-bar-icon">▸</span>
        <span className="top-bar-host">{hostname}</span>
        <span className={`dot ${connected ? "dot-green pulse" : "dot-pink"}`} />
        <span className="top-bar-status">
          {connected ? "connected" : "disconnected"}
        </span>
        {latency != null && (
          <span className="top-bar-latency">{latency}ms</span>
        )}
      </div>
      <div className="top-bar-right">
        <button className="mode-btn mode-active">CLI</button>
        <button className="mode-btn mode-locked" disabled title="Phase 2">
          DE
        </button>
        <button className="disconnect-btn" onClick={onDisconnect}>
          ✕
        </button>
      </div>
    </div>
  );
}
