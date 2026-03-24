import "./TopBar.css";

interface Props {
  hostname: string;
  connected: boolean;
  latency: number | null;
  onDisconnect: () => void;
}

function latencyClass(ms: number): string {
  if (ms < 50) return "latency-good";
  if (ms < 150) return "latency-warn";
  return "latency-bad";
}

export default function TopBar({ hostname, connected, latency, onDisconnect }: Props) {
  return (
    <div className="top-bar">
      <div className="top-bar-left">
        <span className="top-bar-label">TARGET</span>
        <span className="top-bar-host">{hostname}</span>
        <span className={`indicator-diamond ${connected ? "indicator-green indicator-pulse" : "indicator-red"}`} />
        <span className="top-bar-status">
          {connected ? "connected" : "disconnected"}
        </span>
        {latency != null && (
          <span className={`top-bar-latency ${latencyClass(latency)}`}>{latency}ms</span>
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
