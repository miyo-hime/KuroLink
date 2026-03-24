import { useEffect, useState, useCallback } from "react";
import type { ConnectionProfile, HostStatus } from "../lib/types";
import {
  getProfiles,
  getLastProfile,
  saveProfile,
  probeHost,
  connectSsh,
} from "../lib/ipc";
import KuroLinkLogo from "./KuroLinkLogo";
import "./ConnectionScreen.css";

interface Props {
  onConnected: (
    sessionId: string,
    profileId: string,
    profile: ConnectionProfile,
  ) => void;
}

const DEFAULT_PROFILE: Omit<ConnectionProfile, "id" | "created_at"> = {
  name: "",
  host: "",
  port: 22,
  username: "",
  key_path: "~/.ssh/id_ed25519",
  last_connected: null,
};

function statClass(value: number, cautionAt: number, criticalAt: number): string {
  if (value >= criticalAt) return "stat-critical";
  if (value >= cautionAt) return "stat-caution";
  return "stat-nominal";
}

export default function ConnectionScreen({ onConnected }: Props) {
  const [profiles, setProfiles] = useState<ConnectionProfile[]>([]);
  const [form, setForm] = useState({ ...DEFAULT_PROFILE });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [status, setStatus] = useState<HostStatus | null>(null);
  const [probing, setProbing] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load profiles on mount, auto-probe last profile
  useEffect(() => {
    (async () => {
      try {
        const allProfiles = await getProfiles();
        setProfiles(allProfiles);

        const last = await getLastProfile();
        if (last) {
          setSelectedId(last.id);
          setForm({
            name: last.name,
            host: last.host,
            port: last.port,
            username: last.username,
            key_path: last.key_path,
            last_connected: last.last_connected,
          });

          // Auto-probe if we have enough info
          if (last.host && last.username && last.key_path) {
            setProbing(true);
            try {
              const result = await probeHost(last.host, last.port, last.username, last.key_path);
              setStatus(result);
            } catch {
              // Silently fail — user can manually probe
            } finally {
              setProbing(false);
            }
          }
        }
      } catch {
        // Fresh install, no profiles yet
      }
    })();
  }, []);

  const handleProbe = useCallback(async () => {
    if (!form.host || !form.username || !form.key_path) return;
    setProbing(true);
    setError(null);
    try {
      const result = await probeHost(
        form.host,
        form.port,
        form.username,
        form.key_path,
      );
      setStatus(result);
    } catch (e) {
      setStatus(null);
      setError(String(e));
    } finally {
      setProbing(false);
    }
  }, [form]);

  const handleConnect = async () => {
    setConnecting(true);
    setError(null);
    try {
      const profileId =
        selectedId || crypto.randomUUID();
      const now = new Date().toISOString();
      const profile: ConnectionProfile = {
        id: profileId,
        name: form.name,
        host: form.host,
        port: form.port,
        username: form.username,
        key_path: form.key_path,
        created_at: now,
        last_connected: now,
      };
      await saveProfile(profile);

      const sessionId = await connectSsh(
        profileId,
        form.host,
        form.port,
        form.username,
        form.key_path,
      );
      onConnected(sessionId, profileId, profile);
    } catch (e) {
      setError(String(e));
      setConnecting(false);
    }
  };

  const formValid = form.host && form.username && form.key_path;

  return (
    <div className="connection-screen">
      <div className={`connection-content${connecting ? " boot-active" : ""}`}>
        {/* Logo */}
        <KuroLinkLogo />

        {/* Profile selector */}
        {profiles.length > 0 && (
          <div className="profile-selector">
            <label>PROFILE</label>
            <select
              value={selectedId || ""}
              onChange={(e) => {
                const p = profiles.find((p) => p.id === e.target.value);
                if (p) {
                  setSelectedId(p.id);
                  setForm({
                    name: p.name,
                    host: p.host,
                    port: p.port,
                    username: p.username,
                    key_path: p.key_path,
                    last_connected: p.last_connected,
                  });
                } else {
                  setSelectedId(null);
                  setForm({ ...DEFAULT_PROFILE });
                }
                setStatus(null);
              }}
            >
              <option value="">New connection...</option>
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.host})
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Connection form */}
        <div className="hud-frame form-panel">
          <span className="hud-frame-label">CONNECTION PARAMETERS</span>
          <div className="form-row">
            <label className="field-label">NAME</label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="homelab"
            />
          </div>
          <div className="form-row">
            <label className="field-label">HOST</label>
            <input
              type="text"
              value={form.host}
              onChange={(e) => setForm({ ...form, host: e.target.value })}
              placeholder="192.168.x.x"
            />
          </div>
          <div className="form-row">
            <label className="field-label">PORT</label>
            <input
              type="number"
              value={form.port}
              onChange={(e) =>
                setForm({ ...form, port: parseInt(e.target.value) || 22 })
              }
            />
          </div>
          <div className="form-row">
            <label className="field-label">USER</label>
            <input
              type="text"
              value={form.username}
              onChange={(e) => setForm({ ...form, username: e.target.value })}
              placeholder="user"
            />
          </div>
          <div className="form-row">
            <label className="field-label">KEY</label>
            <input
              type="text"
              value={form.key_path}
              onChange={(e) => setForm({ ...form, key_path: e.target.value })}
              placeholder="~/.ssh/id_ed25519"
            />
          </div>
        </div>

        {/* Status panel */}
        <div className={`hud-frame status-panel${probing ? " status-panel-probing" : ""}`}>
          <span className="hud-frame-label">SYSTEM READOUT</span>
          <div className="status-row">
            <span className="field-label">STATUS</span>
            <span className="status-value">
              {probing ? (
                <><span className="indicator-dot indicator-cyan indicator-pulse" /> Probing...</>
              ) : status?.reachable ? (
                <><span className="indicator-dot indicator-green indicator-pulse" /> Reachable</>
              ) : status && !status.reachable ? (
                <><span className="indicator-dot indicator-red" /> Unreachable</>
              ) : (
                <><span className="indicator-dot indicator-dim" /> Unknown</>
              )}
            </span>
          </div>
          {status?.reachable && (
            <>
              <div className="status-row">
                <span className="field-label">LATENCY</span>
                <span className={`status-value ${statClass(status.latency_ms ?? 0, 50, 150)}`}>
                  {status.latency_ms ?? "—"}ms
                </span>
              </div>
              {status.uptime && (
                <div className="status-row">
                  <span className="field-label">UPTIME</span>
                  <span className="status-value">{status.uptime}</span>
                </div>
              )}
              {status.cpu_temp != null && (
                <div className="stat-row-bar">
                  <div className="stat-row-header">
                    <span className="field-label">CPU</span>
                    <span className={`status-value ${statClass(status.cpu_temp, 60, 75)}`}>
                      {status.cpu_temp.toFixed(1)}°C
                    </span>
                  </div>
                  <div className="stat-bar">
                    <div
                      className={`stat-bar-fill ${statClass(status.cpu_temp, 60, 75)}`}
                      style={{ width: `${Math.min(status.cpu_temp, 100)}%` }}
                    />
                  </div>
                </div>
              )}
              {status.memory_used != null && (
                <div className="stat-row-bar">
                  <div className="stat-row-header">
                    <span className="field-label">MEM</span>
                    <span className={`status-value ${statClass(status.memory_used, 70, 85)}`}>
                      {status.memory_used.toFixed(0)}%
                      <span className="text-secondary">of {status.memory_total}</span>
                    </span>
                  </div>
                  <div className="stat-bar">
                    <div
                      className={`stat-bar-fill ${statClass(status.memory_used, 70, 85)}`}
                      style={{ width: `${Math.min(status.memory_used, 100)}%` }}
                    />
                  </div>
                </div>
              )}
              {status.disk_used != null && (
                <div className="stat-row-bar">
                  <div className="stat-row-header">
                    <span className="field-label">DISK</span>
                    <span className={`status-value ${statClass(status.disk_used, 80, 90)}`}>
                      {status.disk_used.toFixed(0)}%
                      <span className="text-secondary">of {status.disk_total}</span>
                    </span>
                  </div>
                  <div className="stat-bar">
                    <div
                      className={`stat-bar-fill ${statClass(status.disk_used, 80, 90)}`}
                      style={{ width: `${Math.min(status.disk_used, 100)}%` }}
                    />
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Probe button */}
        <button
          className={`btn btn-secondary${probing ? " btn-loading" : ""}`}
          onClick={handleProbe}
          disabled={!formValid || probing}
        >
          {probing ? "PROBING..." : "PROBE HOST"}
        </button>

        {/* Connect buttons */}
        <div className="connect-buttons">
          <button
            className={`btn btn-primary${connecting ? " btn-loading" : ""}`}
            onClick={handleConnect}
            disabled={!formValid || connecting}
          >
            {connecting ? "CONNECTING..." : "CONNECT · CLI"}
          </button>
          <button className="btn btn-disabled" disabled title="Coming in Phase 2">
            CONNECT · DE
          </button>
        </div>

        {/* Error display */}
        {error && <div className="error-msg">{error}</div>}

        {/* Last session info */}
        {form.last_connected && (
          <div className="last-session">
            last session: {form.last_connected}
          </div>
        )}
      </div>
    </div>
  );
}
