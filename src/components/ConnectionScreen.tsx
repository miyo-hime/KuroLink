import { useEffect, useState, useCallback } from "react";
import type { ConnectionProfile, HostStatus } from "../lib/types";
import {
  getProfiles,
  getLastProfile,
  saveProfile,
  probeHost,
  connectSsh,
} from "../lib/ipc";
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

export default function ConnectionScreen({ onConnected }: Props) {
  const [profiles, setProfiles] = useState<ConnectionProfile[]>([]);
  const [form, setForm] = useState({ ...DEFAULT_PROFILE });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [status, setStatus] = useState<HostStatus | null>(null);
  const [probing, setProbing] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load profiles on mount
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
      // Create or update profile
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
      <div className="connection-content">
        {/* Logo */}
        <div className="logo-section">
          <pre className="logo-ascii">{`╔═══════════════════════════╗
║       K U R O L I N K     ║
╚═══════════════════════════╝`}</pre>
          <span className="version-label">v0.1.0</span>
        </div>

        {/* Profile selector */}
        {profiles.length > 0 && (
          <div className="profile-selector">
            <label className="field-label">PROFILE</label>
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
        <div className="cyber-panel form-panel">
          <div className="form-row">
            <label className="field-label">NAME</label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="my-server"
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
              placeholder="miyo"
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
        <div className="cyber-panel status-panel">
          <div className="status-row">
            <span className="field-label">STATUS</span>
            <span className="status-value">
              {probing ? (
                <><span className="dot dot-cyan pulse" /> Probing...</>
              ) : status?.reachable ? (
                <><span className="dot dot-green pulse" /> Reachable</>
              ) : status && !status.reachable ? (
                <><span className="dot dot-pink" /> Unreachable</>
              ) : (
                <><span className="dot dot-dim" /> Unknown</>
              )}
            </span>
          </div>
          {status?.reachable && (
            <>
              <div className="status-row">
                <span className="field-label">LATENCY</span>
                <span className="status-value">{status.latency_ms}ms</span>
              </div>
              {status.uptime && (
                <div className="status-row">
                  <span className="field-label">UPTIME</span>
                  <span className="status-value">{status.uptime}</span>
                </div>
              )}
              {status.cpu_temp != null && (
                <div className="status-row">
                  <span className="field-label">CPU TEMP</span>
                  <span className="status-value">{status.cpu_temp.toFixed(1)}°C</span>
                </div>
              )}
              {status.memory_used != null && (
                <div className="status-row">
                  <span className="field-label">MEMORY</span>
                  <span className="status-value">
                    {status.memory_used.toFixed(0)}% of {status.memory_total}
                  </span>
                </div>
              )}
              {status.disk_used != null && (
                <div className="status-row">
                  <span className="field-label">DISK</span>
                  <span className="status-value">
                    {status.disk_used.toFixed(0)}% of {status.disk_total}
                  </span>
                </div>
              )}
            </>
          )}
        </div>

        {/* Probe button */}
        <button
          className="btn btn-secondary"
          onClick={handleProbe}
          disabled={!formValid || probing}
        >
          {probing ? "▸ PROBING..." : "▸ PROBE HOST"}
        </button>

        {/* Connect buttons */}
        <div className="connect-buttons">
          <button
            className="btn btn-primary"
            onClick={handleConnect}
            disabled={!formValid || connecting}
          >
            {connecting ? "▸ CONNECTING..." : "▸ CONNECT · CLI"}
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
