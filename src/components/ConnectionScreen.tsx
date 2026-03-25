import { useEffect, useState, useCallback } from "react";
import type { ConnectionProfile, HostStatus, AgentIdentityInfo, AuthMode } from "../lib/types";
import {
  getProfiles,
  getLastProfile,
  saveProfile,
  deleteProfile,
  probeHost,
  connectSsh,
  encryptPassphrase,
  decryptPassphrase,
  detectAgent,
  listAgentIdentities,
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

function formatTimestamp(ts: string): string {
  const num = Number(ts);
  if (!isNaN(num) && num > 1e9) {
    return new Date(num * 1000).toLocaleString();
  }
  const d = new Date(ts);
  return isNaN(d.getTime()) ? ts : d.toLocaleString();
}

const DEFAULT_PROFILE: Omit<ConnectionProfile, "id" | "created_at"> = {
  name: "",
  host: "",
  port: 22,
  username: "",
  key_path: "~/.ssh/id_ed25519",
  last_connected: null,
  has_passphrase: false,
  saved_passphrase: null,
  auth_mode: "agent",
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
  const [passphrasePrompt, setPassphrasePrompt] = useState(false);
  const [passphrase, setPassphrase] = useState("");
  const [savePass, setSavePass] = useState(false);
  const [agentAvailable, setAgentAvailable] = useState(false);
  const [agentKeys, setAgentKeys] = useState<AgentIdentityInfo[]>([]);

  // Load profiles on mount, auto-probe last profile
  useEffect(() => {
    (async () => {
      // check for ssh agent in the background
      detectAgent().then((ok) => {
        setAgentAvailable(ok);
        if (ok) listAgentIdentities().then(setAgentKeys).catch(() => {});
      }).catch(() => {});

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
            has_passphrase: last.has_passphrase ?? false,
            saved_passphrase: last.saved_passphrase ?? null,
            auth_mode: last.auth_mode ?? "agent",
          });
          if (last.saved_passphrase) {
            setSavePass(true);
            // decrypt so we have it ready for probe/connect
            try {
              const pp = await decryptPassphrase(last.saved_passphrase);
              setPassphrase(pp);
            } catch {
              // corrupted or wrong key, they'll need to re-enter
            }
          }

          // auto-probe if we have enough info
          const mode = last.auth_mode ?? "agent";
          const canProbe = mode === "agent"
            ? last.host && last.username
            : last.host && last.username && last.key_path;
          if (canProbe) {
            setProbing(true);
            try {
              let pp: string | null = null;
              if (mode === "key_file" && last.has_passphrase && last.saved_passphrase) {
                pp = await decryptPassphrase(last.saved_passphrase).catch(() => null);
              }
              const result = await probeHost(last.host, last.port, last.username, last.key_path, pp, mode);
              setStatus(result);
            } catch {
              // whatever, they can probe manually
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

  const formValid = form.auth_mode === "agent"
    ? form.host && form.username
    : form.host && form.username && form.key_path;

  const handleProbe = useCallback(async () => {
    if (!formValid) return;
    setProbing(true);
    setError(null);
    try {
      const pp = form.auth_mode === "key_file" && form.has_passphrase ? passphrase || null : null;
      const result = await probeHost(
        form.host,
        form.port,
        form.username,
        form.key_path,
        pp,
        form.auth_mode,
      );
      setStatus(result);
    } catch (e) {
      setStatus(null);
      setError(String(e));
    } finally {
      setProbing(false);
    }
  }, [form, passphrase]);

  const doConnect = async (pp: string | null) => {
    setConnecting(true);
    setError(null);
    try {
      const profileId = selectedId || crypto.randomUUID();
      const now = new Date().toISOString();

      // encrypt passphrase if user opted to save it
      let savedPassphrase: string | null = null;
      if (form.has_passphrase && savePass && pp) {
        savedPassphrase = await encryptPassphrase(pp);
      }

      const profile: ConnectionProfile = {
        id: profileId,
        name: form.name,
        host: form.host,
        port: form.port,
        username: form.username,
        key_path: form.key_path,
        created_at: now,
        last_connected: now,
        has_passphrase: form.has_passphrase,
        saved_passphrase: savedPassphrase,
        auth_mode: form.auth_mode,
      };
      await saveProfile(profile);

      const sessionId = await connectSsh(
        profileId,
        form.host,
        form.port,
        form.username,
        form.key_path,
        pp,
        form.auth_mode,
      );
      onConnected(sessionId, profileId, profile);
    } catch (e) {
      const msg = String(e);
      if (msg.includes("ENCRYPTED_KEY")) {
        // key is encrypted but we didn't have a passphrase
        setConnecting(false);
        if (!form.has_passphrase) {
          // auto-enable the checkbox since we now know the key needs one
          setForm((prev) => ({ ...prev, has_passphrase: true }));
        }
        setPassphrasePrompt(true);
        setPassphrase("");
      } else {
        setError(msg);
        setConnecting(false);
      }
    }
  };

  const handleConnect = () => {
    const pp = form.has_passphrase ? passphrase || null : null;
    doConnect(pp);
  };

  const handlePassphraseSubmit = () => {
    setPassphrasePrompt(false);
    doConnect(passphrase);
  };

  const handlePassphraseCancel = () => {
    setPassphrasePrompt(false);
    setPassphrase("");
  };

  return (
    <div className="connection-screen">
      <div className="connection-scroll">
      <div className={`connection-content${connecting ? " boot-active" : ""}`}>
        {/* logo */}
        <KuroLinkLogo />

        {/* two-column layout */}
        <div className="connection-body">
          {/* left side */}
          <div className="connection-panels">
            {/* profiles */}
            {profiles.length > 0 && (
              <div className="profile-selector">
                <label>PROFILE</label>
                <div className="profile-selector-row">
                <select
                  value={selectedId || ""}
                  onChange={async (e) => {
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
                        has_passphrase: p.has_passphrase ?? false,
                        saved_passphrase: p.saved_passphrase ?? null,
                        auth_mode: p.auth_mode ?? "agent",
                      });
                      setSavePass(!!p.saved_passphrase);
                      if (p.saved_passphrase) {
                        try {
                          setPassphrase(await decryptPassphrase(p.saved_passphrase));
                        } catch { setPassphrase(""); }
                      } else {
                        setPassphrase("");
                      }
                    } else {
                      setSelectedId(null);
                      setForm({ ...DEFAULT_PROFILE });
                      setPassphrase("");
                      setSavePass(false);
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
                {selectedId && (
                  <button
                    className="btn-delete-profile"
                    title="Delete profile"
                    onClick={async () => {
                      await deleteProfile(selectedId);
                      setProfiles((prev) => prev.filter((p) => p.id !== selectedId));
                      setSelectedId(null);
                      setForm({ ...DEFAULT_PROFILE });
                      setStatus(null);
                    }}
                  >
                    DEL
                  </button>
                )}
                </div>
              </div>
            )}

            {/* form */}
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
              <div className="form-row form-row-checkbox">
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={form.auth_mode === "agent"}
                    onChange={(e) => {
                      const mode: AuthMode = e.target.checked ? "agent" : "key_file";
                      setForm({ ...form, auth_mode: mode });
                      if (mode === "agent" && agentKeys.length === 0) {
                        listAgentIdentities().then(setAgentKeys).catch(() => {});
                      }
                    }}
                  />
                  <span className="toggle-track" />
                  <span className="toggle-label-text">SSH AGENT</span>
                </label>
              </div>
              {form.auth_mode === "agent" ? (
                <div className="agent-keys-panel">
                  {!agentAvailable ? (
                    <div className="agent-status agent-status-warn">no agent detected</div>
                  ) : agentKeys.length === 0 ? (
                    <div className="agent-status agent-status-warn">no keys loaded in agent</div>
                  ) : (
                    <>
                      <div className="agent-status agent-status-ok">{agentKeys.length} key{agentKeys.length !== 1 ? "s" : ""} available</div>
                      <div className="agent-keys-list">
                        {agentKeys.map((k, i) => (
                          <div key={i} className="agent-key-item">
                            <span className="agent-key-type">{k.key_type}</span>
                            <span className="agent-key-fp">{k.fingerprint.slice(0, 24)}...</span>
                            {k.comment && <span className="agent-key-comment">{k.comment}</span>}
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              ) : (
                <>
                  <div className="form-row">
                    <label className="field-label">KEY</label>
                    <input
                      type="text"
                      value={form.key_path}
                      onChange={(e) => setForm({ ...form, key_path: e.target.value })}
                      placeholder="~/.ssh/id_ed25519"
                    />
                  </div>
                  <div className="form-row form-row-checkbox">
                    <label className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={form.has_passphrase}
                        onChange={(e) => {
                          setForm({ ...form, has_passphrase: e.target.checked });
                          if (!e.target.checked) {
                            setPassphrase("");
                            setSavePass(false);
                          }
                        }}
                      />
                      <span className="toggle-track" />
                      <span className="toggle-label-text">KEY PASSPHRASE</span>
                    </label>
                  </div>
                  {form.has_passphrase && (
                    <>
                      <div className="form-row">
                        <label className="field-label">PASS</label>
                        <input
                          type="password"
                          value={passphrase}
                          onChange={(e) => setPassphrase(e.target.value)}
                          placeholder="key passphrase"
                        />
                      </div>
                      <div className="form-row form-row-checkbox">
                        <label className="checkbox-label">
                          <input
                            type="checkbox"
                            checked={savePass}
                            onChange={(e) => setSavePass(e.target.checked)}
                          />
                          <span className="toggle-track" />
                          <span className="toggle-label-text">SAVE ENCRYPTED</span>
                        </label>
                      </div>
                    </>
                  )}
                </>
              )}
            </div>

            {/* status - always visible, four visual states */}
            <div className={`hud-frame status-panel${
              probing ? " status-panel-scanning" :
              status?.reachable ? " status-panel-locked" :
              status && !status.reachable ? " status-panel-failed" :
              " status-panel-idle"
            }`}>
              <span className="hud-frame-label">SYSTEM READOUT</span>
              <div className="scanline-overlay" />

              {/* status line */}
              <div className="status-row">
                <span className="field-label">STATUS</span>
                <span className="status-value">
                  {probing ? (
                    <><span className="indicator-dot indicator-cyan indicator-pulse" /><span className="signal-text signal-scanning">ACQUIRING SIGNAL...</span></>
                  ) : status?.reachable ? (
                    <><span className="indicator-dot indicator-green indicator-pulse" /><span className="signal-text signal-locked">SIGNAL LOCKED</span></>
                  ) : status && !status.reachable ? (
                    <><span className="indicator-dot indicator-red" /><span className="signal-text signal-failed">NO SIGNAL</span></>
                  ) : (
                    <><span className="indicator-dot indicator-dim" /><span className="signal-text">STANDBY</span></>
                  )}
                </span>
              </div>

              {/* latency - always rendered */}
              <div className={`status-row stat-instrument${status?.reachable ? " stat-instrument-live" : ""}`} style={{ animationDelay: "0.05s" }}>
                <span className="field-label">LATENCY</span>
                <span className={`status-value ${status?.reachable ? statClass(status.latency_ms ?? 0, 50, 150) : ""}`}>
                  {status?.reachable ? `${status.latency_ms ?? "—"}ms` : <span className="stat-placeholder">---</span>}
                </span>
              </div>

              {/* uptime */}
              <div className={`status-row stat-instrument${status?.reachable ? " stat-instrument-live" : ""}`} style={{ animationDelay: "0.12s" }}>
                <span className="field-label">UPTIME</span>
                <span className="status-value">
                  {status?.reachable && status.uptime ? status.uptime : <span className="stat-placeholder">---</span>}
                </span>
              </div>

              {/* cpu */}
              <div className={`stat-row-bar stat-instrument${status?.reachable ? " stat-instrument-live" : ""}`} style={{ animationDelay: "0.2s" }}>
                <div className="stat-row-header">
                  <span className="field-label">CPU</span>
                  <span className={`status-value ${status?.reachable && status.cpu_temp != null ? statClass(status.cpu_temp, 60, 75) : ""}`}>
                    {status?.reachable && status.cpu_temp != null
                      ? `${status.cpu_temp.toFixed(1)}°C`
                      : <span className="stat-placeholder">---</span>}
                  </span>
                </div>
                <div className="stat-bar">
                  {probing ? (
                    <div className="stat-bar-noise" />
                  ) : (
                    <div
                      className={`stat-bar-fill ${status?.reachable && status.cpu_temp != null ? statClass(status.cpu_temp, 60, 75) : "stat-empty"}`}
                      style={{ width: status?.reachable && status.cpu_temp != null ? `${Math.min(status.cpu_temp, 100)}%` : "0%" }}
                    />
                  )}
                </div>
              </div>

              {/* mem */}
              <div className={`stat-row-bar stat-instrument${status?.reachable ? " stat-instrument-live" : ""}`} style={{ animationDelay: "0.28s" }}>
                <div className="stat-row-header">
                  <span className="field-label">MEM</span>
                  <span className={`status-value ${status?.reachable && status.memory_used != null ? statClass(status.memory_used, 70, 85) : ""}`}>
                    {status?.reachable && status.memory_used != null
                      ? <>{status.memory_used.toFixed(0)}%<span className="text-secondary">of {status.memory_total}</span></>
                      : <span className="stat-placeholder">---</span>}
                  </span>
                </div>
                <div className="stat-bar">
                  {probing ? (
                    <div className="stat-bar-noise" />
                  ) : (
                    <div
                      className={`stat-bar-fill ${status?.reachable && status.memory_used != null ? statClass(status.memory_used, 70, 85) : "stat-empty"}`}
                      style={{ width: status?.reachable && status.memory_used != null ? `${Math.min(status.memory_used, 100)}%` : "0%" }}
                    />
                  )}
                </div>
              </div>

              {/* disk */}
              <div className={`stat-row-bar stat-instrument${status?.reachable ? " stat-instrument-live" : ""}`} style={{ animationDelay: "0.35s" }}>
                <div className="stat-row-header">
                  <span className="field-label">DISK</span>
                  <span className={`status-value ${status?.reachable && status.disk_used != null ? statClass(status.disk_used, 80, 90) : ""}`}>
                    {status?.reachable && status.disk_used != null
                      ? <>{status.disk_used.toFixed(0)}%<span className="text-secondary">of {status.disk_total}</span></>
                      : <span className="stat-placeholder">---</span>}
                  </span>
                </div>
                <div className="stat-bar">
                  {probing ? (
                    <div className="stat-bar-noise" />
                  ) : (
                    <div
                      className={`stat-bar-fill ${status?.reachable && status.disk_used != null ? statClass(status.disk_used, 80, 90) : "stat-empty"}`}
                      style={{ width: status?.reachable && status.disk_used != null ? `${Math.min(status.disk_used, 100)}%` : "0%" }}
                    />
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* command switches */}
          <div className="command-switches">
            <span className="command-switches-label">COMMAND</span>

            {/* probe */}
            <button
              className={`cmd-switch${probing ? " cmd-switch-active" : ""}${status?.reachable ? " cmd-switch-success" : ""}`}
              onClick={handleProbe}
              disabled={!formValid || probing}
            >
              <span className={`cmd-switch-indicator${probing ? " indicator-pulse" : ""}${status?.reachable ? " indicator-green" : ""}`} />
              <span className="cmd-switch-label">PROBE</span>
              <span className="cmd-switch-sub">SCAN</span>
            </button>

            {/* cli */}
            <button
              className={`cmd-switch cmd-switch-primary${connecting ? " cmd-switch-active" : ""}`}
              onClick={handleConnect}
              disabled={!formValid || connecting}
            >
              <span className={`cmd-switch-indicator${connecting ? " indicator-pulse indicator-cyan" : ""}`} />
              <span className="cmd-switch-label">CLI</span>
              <span className="cmd-switch-sub">TERMINAL</span>
            </button>

            {/* de - locked for now */}
            <button
              className="cmd-switch cmd-switch-locked"
              disabled
              title="Coming in Phase 2"
            >
              <span className="cmd-switch-indicator" />
              <span className="cmd-switch-label">DE</span>
              <span className="cmd-switch-sub">DESKTOP</span>
              <span className="cmd-switch-lock">LOCKED</span>
            </button>
          </div>
        </div>

        {/* passphrase */}
        {passphrasePrompt && (
          <div className="hud-frame passphrase-panel">
            <span className="hud-frame-label">KEY PASSPHRASE</span>
            <p className="passphrase-hint">Your SSH key is encrypted. Enter the passphrase to unlock it.</p>
            <input
              type="password"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && passphrase && handlePassphraseSubmit()}
              placeholder="Passphrase"
              autoFocus
            />
            <div className="passphrase-buttons">
              <button className="btn btn-secondary" onClick={handlePassphraseCancel}>
                CANCEL
              </button>
              <button
                className="btn btn-primary"
                onClick={handlePassphraseSubmit}
                disabled={!passphrase}
              >
                UNLOCK
              </button>
            </div>
          </div>
        )}

        {/* error */}
        {error && <div className="error-msg">{error}</div>}

        {/* last session */}
        {form.last_connected && (
          <div className="last-session">
            last session: {formatTimestamp(form.last_connected)}
          </div>
        )}
      </div>
      </div>
    </div>
  );
}
