<script lang="ts">
  import { onMount } from "svelte";
  import { DEFAULT_LOCAL_SHELLS } from "../lib/types";
  import type { ConnectionProfile, HostStatus, AgentIdentityInfo, AuthMode, LocalShellId, LocalShellInfo } from "../lib/types";
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
    detectLocalShells,
    listAgentIdentities,
  } from "../lib/ipc";
  import KuroLinkLogo from "./KuroLinkLogo.svelte";
  import Titlebar from "./Titlebar.svelte";

  interface Props {
    onConnected: (
      sessionId: string,
      profileId: string,
      profile: ConnectionProfile,
    ) => void;
    onLocalTerminal: (shellType: LocalShellId) => void;
  }

  let { onConnected, onLocalTerminal }: Props = $props();

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

  let profiles = $state<ConnectionProfile[]>([]);
  let form = $state({ ...DEFAULT_PROFILE });
  let selectedId = $state<string | null>(null);
  let status = $state<HostStatus | null>(null);
  let probing = $state(false);
  let connecting = $state(false);
  let error = $state<string | null>(null);
  let passphrasePrompt = $state(false);
  let passphrase = $state("");
  let savePass = $state(false);
  let agentAvailable = $state(false);
  let agentKeys = $state<AgentIdentityInfo[]>([]);
  let localShells = $state<LocalShellInfo[]>(DEFAULT_LOCAL_SHELLS);

  let formValid = $derived(
    form.auth_mode === "agent"
      ? form.host && form.username
      : form.host && form.username && form.key_path,
  );

  // load profiles on mount, auto-probe last profile
  onMount(() => {
    (async () => {
      // check for ssh agent in the background
      detectAgent().then((ok) => {
        agentAvailable = ok;
        if (ok) listAgentIdentities().then((k) => (agentKeys = k)).catch(() => {});
      }).catch(() => {});
      detectLocalShells().then((s) => (localShells = s)).catch(() => {});

      try {
        profiles = await getProfiles();

        const last = await getLastProfile();
        if (last) {
          selectedId = last.id;
          form = {
            name: last.name,
            host: last.host,
            port: last.port,
            username: last.username,
            key_path: last.key_path,
            last_connected: last.last_connected,
            has_passphrase: last.has_passphrase ?? false,
            saved_passphrase: last.saved_passphrase ?? null,
            auth_mode: last.auth_mode ?? "agent",
          };
          if (last.saved_passphrase) {
            savePass = true;
            // decrypt so we have it ready for probe/connect
            try {
              passphrase = await decryptPassphrase(last.saved_passphrase);
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
            probing = true;
            try {
              let pp: string | null = null;
              if (mode === "key_file" && last.has_passphrase && last.saved_passphrase) {
                pp = await decryptPassphrase(last.saved_passphrase).catch(() => null);
              }
              status = await probeHost(last.host, last.port, last.username, last.key_path, pp, mode);
            } catch {
              // whatever, they can probe manually
            } finally {
              probing = false;
            }
          }
        }
      } catch {
        // fresh install, no profiles yet
      }
    })();
  });

  async function handleProfileChange(e: Event) {
    const value = (e.currentTarget as HTMLSelectElement).value;
    const p = profiles.find((p) => p.id === value);
    if (p) {
      selectedId = p.id;
      form = {
        name: p.name,
        host: p.host,
        port: p.port,
        username: p.username,
        key_path: p.key_path,
        last_connected: p.last_connected,
        has_passphrase: p.has_passphrase ?? false,
        saved_passphrase: p.saved_passphrase ?? null,
        auth_mode: p.auth_mode ?? "agent",
      };
      savePass = !!p.saved_passphrase;
      if (p.saved_passphrase) {
        try {
          passphrase = await decryptPassphrase(p.saved_passphrase);
        } catch { passphrase = ""; }
      } else {
        passphrase = "";
      }
    } else {
      selectedId = null;
      form = { ...DEFAULT_PROFILE };
      passphrase = "";
      savePass = false;
    }
    status = null;
  }

  async function handleDeleteProfile() {
    if (!selectedId) return;
    await deleteProfile(selectedId);
    const id = selectedId;
    profiles = profiles.filter((p) => p.id !== id);
    selectedId = null;
    form = { ...DEFAULT_PROFILE };
    status = null;
  }

  function handleAuthModeToggle(e: Event) {
    const checked = (e.currentTarget as HTMLInputElement).checked;
    const mode: AuthMode = checked ? "agent" : "key_file";
    form.auth_mode = mode;
    if (mode === "agent" && agentKeys.length === 0) {
      listAgentIdentities().then((k) => (agentKeys = k)).catch(() => {});
    }
  }

  function handlePassphraseToggle(e: Event) {
    const checked = (e.currentTarget as HTMLInputElement).checked;
    form.has_passphrase = checked;
    if (!checked) {
      passphrase = "";
      savePass = false;
    }
  }

  async function handleProbe() {
    if (!formValid) return;
    probing = true;
    error = null;
    try {
      const pp = form.auth_mode === "key_file" && form.has_passphrase ? passphrase || null : null;
      status = await probeHost(
        form.host,
        form.port,
        form.username,
        form.key_path,
        pp,
        form.auth_mode,
      );
    } catch (e) {
      status = null;
      error = String(e);
    } finally {
      probing = false;
    }
  }

  async function doConnect(pp: string | null) {
    connecting = true;
    error = null;
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
        connecting = false;
        if (!form.has_passphrase) {
          // auto-enable the checkbox since we now know the key needs one
          form.has_passphrase = true;
        }
        passphrasePrompt = true;
        passphrase = "";
      } else {
        error = msg;
        connecting = false;
      }
    }
  }

  function handleConnect() {
    const pp = form.has_passphrase ? passphrase || null : null;
    doConnect(pp);
  }

  function handlePassphraseSubmit() {
    passphrasePrompt = false;
    doConnect(passphrase);
  }

  function handlePassphraseCancel() {
    passphrasePrompt = false;
    passphrase = "";
  }
</script>

<div class="connection-screen">
  <Titlebar />
  <div class="connection-scroll">
    <div class="connection-content{connecting ? ' boot-active' : ''}">
      <!-- logo -->
      <KuroLinkLogo />

      <!-- two-column layout -->
      <div class="connection-body">
        <!-- left side -->
        <div class="connection-panels">
          <!-- profiles -->
          {#if profiles.length > 0}
            <div class="profile-selector">
              <label for="profile-select">PROFILE</label>
              <div class="profile-selector-row">
                <select id="profile-select" value={selectedId || ""} onchange={handleProfileChange}>
                  <option value="">New connection...</option>
                  {#each profiles as p (p.id)}
                    <option value={p.id}>{p.name} ({p.host})</option>
                  {/each}
                </select>
                {#if selectedId}
                  <button class="btn-delete-profile" title="Delete profile" onclick={handleDeleteProfile}>
                    DEL
                  </button>
                {/if}
              </div>
            </div>
          {/if}

          <!-- form -->
          <div class="hud-frame form-panel">
            <span class="hud-frame-label">CONNECTION PARAMETERS</span>
            <div class="form-row">
              <label class="field-label" for="f-name">NAME</label>
              <input id="f-name" type="text" bind:value={form.name} placeholder="homelab" />
            </div>
            <div class="form-row">
              <label class="field-label" for="f-host">HOST</label>
              <input id="f-host" type="text" bind:value={form.host} placeholder="192.168.x.x" />
            </div>
            <div class="form-row">
              <label class="field-label" for="f-port">PORT</label>
              <input
                id="f-port"
                type="number"
                value={form.port}
                oninput={(e) => (form.port = parseInt(e.currentTarget.value) || 22)}
              />
            </div>
            <div class="form-row">
              <label class="field-label" for="f-user">USER</label>
              <input id="f-user" type="text" bind:value={form.username} placeholder="user" />
            </div>
            <div class="form-row form-row-checkbox">
              <label class="checkbox-label">
                <input
                  type="checkbox"
                  checked={form.auth_mode === "agent"}
                  onchange={handleAuthModeToggle}
                />
                <span class="toggle-track"></span>
                <span class="toggle-label-text">SSH AGENT</span>
              </label>
            </div>
            {#if form.auth_mode === "agent"}
              <div class="agent-keys-panel">
                {#if !agentAvailable}
                  <div class="agent-status agent-status-warn">no agent detected</div>
                {:else if agentKeys.length === 0}
                  <div class="agent-status agent-status-warn">no keys loaded in agent</div>
                {:else}
                  <div class="agent-status agent-status-ok">{agentKeys.length} key{agentKeys.length !== 1 ? "s" : ""} available</div>
                  <div class="agent-keys-list">
                    {#each agentKeys as k, i (i)}
                      <div class="agent-key-item">
                        <span class="agent-key-type">{k.key_type}</span>
                        <span class="agent-key-fp">{k.fingerprint.slice(0, 24)}...</span>
                        {#if k.comment}<span class="agent-key-comment">{k.comment}</span>{/if}
                      </div>
                    {/each}
                  </div>
                {/if}
              </div>
            {:else}
              <div class="form-row">
                <label class="field-label" for="f-key">KEY</label>
                <input id="f-key" type="text" bind:value={form.key_path} placeholder="~/.ssh/id_ed25519" />
              </div>
              <div class="form-row form-row-checkbox">
                <label class="checkbox-label">
                  <input
                    type="checkbox"
                    checked={form.has_passphrase}
                    onchange={handlePassphraseToggle}
                  />
                  <span class="toggle-track"></span>
                  <span class="toggle-label-text">KEY PASSPHRASE</span>
                </label>
              </div>
              {#if form.has_passphrase}
                <div class="form-row">
                  <label class="field-label" for="f-pass">PASS</label>
                  <input id="f-pass" type="password" bind:value={passphrase} placeholder="key passphrase" />
                </div>
                <div class="form-row form-row-checkbox">
                  <label class="checkbox-label">
                    <input type="checkbox" bind:checked={savePass} />
                    <span class="toggle-track"></span>
                    <span class="toggle-label-text">SAVE ENCRYPTED</span>
                  </label>
                </div>
              {/if}
            {/if}
          </div>

          <!-- status - always visible, four visual states -->
          <div class="hud-frame status-panel {probing ? 'status-panel-scanning' : status?.reachable ? 'status-panel-locked' : status && !status.reachable ? 'status-panel-failed' : 'status-panel-idle'}">
            <span class="hud-frame-label">SYSTEM READOUT</span>
            <div class="scanline-overlay"></div>

            <!-- status line -->
            <div class="status-row">
              <span class="field-label">STATUS</span>
              <span class="status-value">
                {#if probing}
                  <span class="indicator-dot indicator-cyan indicator-pulse"></span><span class="signal-text signal-scanning">ACQUIRING SIGNAL...</span>
                {:else if status?.reachable}
                  <span class="indicator-dot indicator-green indicator-pulse"></span><span class="signal-text signal-locked">SIGNAL LOCKED</span>
                {:else if status && !status.reachable}
                  <span class="indicator-dot indicator-red"></span><span class="signal-text signal-failed">NO SIGNAL</span>
                {:else}
                  <span class="indicator-dot indicator-dim"></span><span class="signal-text">STANDBY</span>
                {/if}
              </span>
            </div>

            <!-- latency - always rendered -->
            <div class="status-row stat-instrument {status?.reachable ? 'stat-instrument-live' : ''}" style="animation-delay: 0.05s">
              <span class="field-label">LATENCY</span>
              <span class="status-value {status?.reachable ? statClass(status.latency_ms ?? 0, 50, 150) : ''}">
                {#if status?.reachable}
                  {status.latency_ms ?? "—"}ms
                {:else}
                  <span class="stat-placeholder">---</span>
                {/if}
              </span>
            </div>

            <!-- uptime -->
            <div class="status-row stat-instrument {status?.reachable ? 'stat-instrument-live' : ''}" style="animation-delay: 0.12s">
              <span class="field-label">UPTIME</span>
              <span class="status-value">
                {#if status?.reachable && status.uptime}
                  {status.uptime}
                {:else}
                  <span class="stat-placeholder">---</span>
                {/if}
              </span>
            </div>

            <!-- cpu -->
            <div class="stat-row-bar stat-instrument {status?.reachable ? 'stat-instrument-live' : ''}" style="animation-delay: 0.2s">
              <div class="stat-row-header">
                <span class="field-label">CPU</span>
                <span class="status-value {status?.reachable && status.cpu_temp != null ? statClass(status.cpu_temp, 60, 75) : ''}">
                  {#if status?.reachable && status.cpu_temp != null}
                    {status.cpu_temp.toFixed(1)}°C
                  {:else}
                    <span class="stat-placeholder">---</span>
                  {/if}
                </span>
              </div>
              <div class="stat-bar">
                {#if probing}
                  <div class="stat-bar-noise"></div>
                {:else}
                  <div
                    class="stat-bar-fill {status?.reachable && status.cpu_temp != null ? statClass(status.cpu_temp, 60, 75) : 'stat-empty'}"
                    style="width: {status?.reachable && status.cpu_temp != null ? `${Math.min(status.cpu_temp, 100)}%` : '0%'}"
                  ></div>
                {/if}
              </div>
            </div>

            <!-- mem -->
            <div class="stat-row-bar stat-instrument {status?.reachable ? 'stat-instrument-live' : ''}" style="animation-delay: 0.28s">
              <div class="stat-row-header">
                <span class="field-label">MEM</span>
                <span class="status-value {status?.reachable && status.memory_used != null ? statClass(status.memory_used, 70, 85) : ''}">
                  {#if status?.reachable && status.memory_used != null}
                    {status.memory_used.toFixed(0)}%<span class="text-secondary">of {status.memory_total}</span>
                  {:else}
                    <span class="stat-placeholder">---</span>
                  {/if}
                </span>
              </div>
              <div class="stat-bar">
                {#if probing}
                  <div class="stat-bar-noise"></div>
                {:else}
                  <div
                    class="stat-bar-fill {status?.reachable && status.memory_used != null ? statClass(status.memory_used, 70, 85) : 'stat-empty'}"
                    style="width: {status?.reachable && status.memory_used != null ? `${Math.min(status.memory_used, 100)}%` : '0%'}"
                  ></div>
                {/if}
              </div>
            </div>

            <!-- disk -->
            <div class="stat-row-bar stat-instrument {status?.reachable ? 'stat-instrument-live' : ''}" style="animation-delay: 0.35s">
              <div class="stat-row-header">
                <span class="field-label">DISK</span>
                <span class="status-value {status?.reachable && status.disk_used != null ? statClass(status.disk_used, 80, 90) : ''}">
                  {#if status?.reachable && status.disk_used != null}
                    {status.disk_used.toFixed(0)}%<span class="text-secondary">of {status.disk_total}</span>
                  {:else}
                    <span class="stat-placeholder">---</span>
                  {/if}
                </span>
              </div>
              <div class="stat-bar">
                {#if probing}
                  <div class="stat-bar-noise"></div>
                {:else}
                  <div
                    class="stat-bar-fill {status?.reachable && status.disk_used != null ? statClass(status.disk_used, 80, 90) : 'stat-empty'}"
                    style="width: {status?.reachable && status.disk_used != null ? `${Math.min(status.disk_used, 100)}%` : '0%'}"
                  ></div>
                {/if}
              </div>
            </div>
          </div>
        </div>

        <!-- command switches -->
        <div class="command-panel">
          <span class="command-panel-label">COMMAND</span>
          <div class="command-columns">
            <div class="command-column">
              <span class="command-column-label">REMOTE</span>
              <button
                class="cmd-switch{probing ? ' cmd-switch-active' : ''}{status?.reachable ? ' cmd-switch-success' : ''}"
                onclick={handleProbe}
                disabled={!formValid || probing}
              >
                <span class="cmd-switch-indicator{probing ? ' indicator-pulse' : ''}{status?.reachable ? ' indicator-green' : ''}"></span>
                <span class="cmd-switch-label">PROBE</span>
                <span class="cmd-switch-sub">SCAN</span>
              </button>
              <button
                class="cmd-switch cmd-switch-primary{connecting ? ' cmd-switch-active' : ''}"
                onclick={handleConnect}
                disabled={!formValid || connecting}
              >
                <span class="cmd-switch-indicator{connecting ? ' indicator-pulse indicator-cyan' : ''}"></span>
                <span class="cmd-switch-label">CLI</span>
                <span class="cmd-switch-sub">TERMINAL</span>
              </button>
              <button class="cmd-switch cmd-switch-locked" disabled title="Coming in Phase 2">
                <span class="cmd-switch-indicator"></span>
                <span class="cmd-switch-label">DE</span>
                <span class="cmd-switch-sub">DESKTOP</span>
                <span class="cmd-switch-lock">LOCKED</span>
              </button>
            </div>
            <div class="command-column">
              <span class="command-column-label">LOCAL</span>
              {#each localShells as shell (shell.id)}
                <button
                  class="cmd-switch cmd-switch-local{!shell.available ? ' cmd-switch-missing' : ''}"
                  onclick={() => onLocalTerminal(shell.id)}
                  disabled={!shell.available}
                  title={shell.available ? shell.label : `${shell.label} not found`}
                >
                  <span class="cmd-switch-indicator{shell.available ? ' indicator-green' : ''}"></span>
                  <span class="cmd-switch-label">{shell.shortLabel}</span>
                  <span class="cmd-switch-sub">{shell.available ? shell.subtitle : "NOT FOUND"}</span>
                </button>
              {/each}
            </div>
          </div>
        </div>
      </div>

      <!-- passphrase -->
      {#if passphrasePrompt}
        <div class="hud-frame passphrase-panel">
          <span class="hud-frame-label">KEY PASSPHRASE</span>
          <p class="passphrase-hint">Your SSH key is encrypted. Enter the passphrase to unlock it.</p>
          <!-- svelte-ignore a11y_autofocus -->
          <input
            type="password"
            bind:value={passphrase}
            onkeydown={(e) => e.key === "Enter" && passphrase && handlePassphraseSubmit()}
            placeholder="Passphrase"
            autofocus
          />
          <div class="passphrase-buttons">
            <button class="btn btn-secondary" onclick={handlePassphraseCancel}>
              CANCEL
            </button>
            <button class="btn btn-primary" onclick={handlePassphraseSubmit} disabled={!passphrase}>
              UNLOCK
            </button>
          </div>
        </div>
      {/if}

      <!-- error -->
      {#if error}<div class="error-msg">{error}</div>{/if}

      <!-- last session -->
      {#if form.last_connected}
        <div class="last-session">
          last session: {formatTimestamp(form.last_connected)}
        </div>
      {/if}
    </div>
  </div>
</div>

<style>
  .connection-screen {
    height: 100%;
    width: 100%;
    display: flex;
    flex-direction: column;
    background:
      radial-gradient(
        ellipse at center,
        transparent 40%,
        rgba(0, 0, 0, 0.4) 100%
      ),
      var(--bg-primary);
    overflow: hidden;
    position: relative;
  }

  /* inner scroll wrapper so content can still scroll if window is short */
  .connection-scroll {
    position: relative;
    z-index: 1;
    width: 100%;
    flex: 1;
    min-height: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow-y: auto;
  }

  /* radar ping - expanding ring that reveals the grid as it passes */
  .connection-screen::before {
    content: "";
    position: absolute;
    inset: 0;
    pointer-events: none;
    /* grid lines layered behind a radial mask - grid only shows where the ring is */
    background:
      repeating-linear-gradient(
        0deg,
        rgba(0, 212, 255, 0.08) 0px,
        rgba(0, 212, 255, 0.08) 1px,
        transparent 1px,
        transparent 40px
      ),
      repeating-linear-gradient(
        90deg,
        rgba(0, 212, 255, 0.08) 0px,
        rgba(0, 212, 255, 0.08) 1px,
        transparent 1px,
        transparent 40px
      );
    /* radial mask - only the ring area is visible */
    mask-image: radial-gradient(
      circle at 50% 50%,
      transparent 0%,
      transparent 38%,
      rgba(0, 0, 0, 0.4) 42%,
      black 46%,
      black 50%,
      rgba(0, 0, 0, 0.4) 54%,
      transparent 58%,
      transparent 100%
    );
    -webkit-mask-image: radial-gradient(
      circle at 50% 50%,
      transparent 0%,
      transparent 38%,
      rgba(0, 0, 0, 0.4) 42%,
      black 46%,
      black 50%,
      rgba(0, 0, 0, 0.4) 54%,
      transparent 58%,
      transparent 100%
    );
    mask-repeat: no-repeat;
    -webkit-mask-repeat: no-repeat;
    mask-position: center;
    -webkit-mask-position: center;
    animation: grid-ping 4s ease-out infinite;
    z-index: 0;
  }

  /* slow vertical scan band across the grid */
  .connection-screen::after {
    content: "";
    position: absolute;
    left: 0;
    right: 0;
    height: 150px;
    pointer-events: none;
    background: linear-gradient(
      180deg,
      transparent 0%,
      rgba(0, 212, 255, 0.003) 30%,
      rgba(0, 212, 255, 0.008) 50%,
      rgba(0, 212, 255, 0.003) 60%,
      transparent 100%
    );
    animation: scan-line 8s linear infinite;
    z-index: 0;
  }

  @keyframes grid-ping {
    0% {
      mask-size: 40% 40%;
      -webkit-mask-size: 40% 40%;
      opacity: 0;
    }
    8% {
      opacity: 1;
    }
    80% {
      opacity: 0.6;
    }
    100% {
      mask-size: 300% 300%;
      -webkit-mask-size: 300% 300%;
      opacity: 0;
    }
  }

  .connection-content {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1.25rem;
    padding: 1.5rem 2rem;
    max-width: 620px;
    width: 100%;
    animation: view-enter 0.4s var(--transition-smooth) both;
  }

  /* boot sequence - children include the logo (a child component), so the
     stagger targets have to be global; a scoped `> *` can't reach them */
  .connection-content.boot-active > :global(*) {
    animation: boot-sequence 0.5s cubic-bezier(0.4, 0, 0.2, 1) both;
  }
  .connection-content.boot-active > :global(*:nth-child(1)) { animation-delay: 0s; }
  .connection-content.boot-active > :global(*:nth-child(2)) { animation-delay: 0.08s; }
  .connection-content.boot-active > :global(*:nth-child(3)) { animation-delay: 0.16s; }
  .connection-content.boot-active > :global(*:nth-child(4)) { animation-delay: 0.24s; }
  .connection-content.boot-active > :global(*:nth-child(5)) { animation-delay: 0.32s; }
  .connection-content.boot-active > :global(*:nth-child(6)) { animation-delay: 0.4s; }

  /* ---- layout ---- */

  .connection-body {
    display: flex;
    gap: 1.25rem;
    width: 100%;
    align-items: flex-start;
  }

  .connection-panels {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 1rem;
    min-width: 0;
  }

  /* ---- profiles ---- */

  .profile-selector {
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }

  .profile-selector label {
    color: var(--text-label);
    font-size: 0.6rem;
    font-weight: 600;
    letter-spacing: 0.15em;
    text-transform: uppercase;
  }

  .profile-selector-row {
    display: flex;
    gap: 0.4rem;
    align-items: stretch;
  }

  .profile-selector select {
    flex: 1;
    background: var(--bg-terminal);
    color: var(--text-primary);
    border: 1px solid var(--border-subtle);
    border-left: 2px solid var(--hud-line);
    padding: 0.5rem 0.75rem;
    font-family: inherit;
    font-size: 0.8rem;
    outline: none;
    transition: border-color var(--transition-normal), box-shadow var(--transition-normal);
  }

  .profile-selector select:focus {
    border-color: var(--accent-primary);
    border-left-color: var(--accent-primary);
    box-shadow: var(--glow-sm) rgba(0, 212, 255, 0.15);
  }

  .btn-delete-profile {
    background: transparent;
    border: 1px solid rgba(232, 37, 78, 0.3);
    color: var(--accent-secondary);
    font-family: inherit;
    font-size: 0.6rem;
    font-weight: 600;
    letter-spacing: 0.1em;
    padding: 0 0.6rem;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .btn-delete-profile:hover {
    background: rgba(232, 37, 78, 0.1);
    border-color: var(--accent-secondary);
  }

  /* ---- form ---- */

  .form-panel {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .form-row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    position: relative;
  }

  .field-label {
    color: var(--text-label);
    font-size: 0.6rem;
    font-weight: 600;
    letter-spacing: 0.15em;
    text-transform: uppercase;
    min-width: 50px;
    flex-shrink: 0;
  }

  /* prompt chevron */
  .form-row::before {
    content: "\203A";
    color: var(--text-dim);
    font-size: 0.9rem;
    flex-shrink: 0;
    width: 8px;
    text-align: center;
    transition: color var(--transition-fast);
  }

  .form-row:focus-within::before {
    color: var(--accent-primary);
  }

  .form-row input {
    flex: 1;
    background: var(--bg-terminal);
    color: var(--text-primary);
    border: 1px solid transparent;
    border-left: 2px solid var(--hud-line);
    padding: 0.4rem 0.6rem;
    font-family: inherit;
    font-size: 0.8rem;
    outline: none;
    transition: border-color var(--transition-normal), box-shadow var(--transition-normal);
  }

  .form-row input:focus {
    border-color: rgba(0, 212, 255, 0.15);
    border-left-color: var(--accent-primary);
    box-shadow: inset 2px 0 8px rgba(0, 212, 255, 0.06);
  }

  .form-row input::placeholder {
    color: var(--text-dim);
    opacity: 0.5;
  }

  /* toggle switches */

  .form-row-checkbox {
    padding-left: 0.5rem;
    padding-top: 0.15rem;
    padding-bottom: 0.15rem;
  }

  .form-row-checkbox::before {
    content: none;
  }

  .checkbox-label {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    cursor: pointer;
    user-select: none;
  }

  /* hide the real checkbox */
  .checkbox-label input[type="checkbox"] {
    position: absolute;
    opacity: 0;
    width: 0;
    height: 0;
    pointer-events: none;
  }

  /* the switch track */
  .toggle-track {
    position: relative;
    width: 34px;
    height: 16px;
    flex-shrink: 0;
    background: var(--bg-terminal);
    border: 1.5px solid var(--border-subtle);
    clip-path: polygon(
      0 0,
      calc(100% - 4px) 0,
      100% 4px,
      100% 100%,
      4px 100%,
      0 calc(100% - 4px)
    );
    transition: all var(--transition-fast);
  }

  /* track inner glow when off - subtle */
  .toggle-track::before {
    content: "";
    position: absolute;
    inset: 0;
    background: linear-gradient(90deg, transparent 50%, rgba(0, 212, 255, 0.02) 100%);
    transition: all var(--transition-fast);
  }

  /* the slider carriage */
  .toggle-track::after {
    content: "";
    position: absolute;
    top: 2px;
    left: 2px;
    width: 10px;
    height: 8px;
    background: var(--text-dim);
    clip-path: polygon(
      0 0,
      calc(100% - 2px) 0,
      100% 2px,
      100% 100%,
      2px 100%,
      0 calc(100% - 2px)
    );
    transition: all 0.15s cubic-bezier(0.4, 0, 0.2, 1);
    box-shadow: none;
  }

  /* hover - brighten track */
  .checkbox-label:hover .toggle-track {
    border-color: rgba(0, 212, 255, 0.2);
  }

  .checkbox-label:hover .toggle-track::after {
    background: var(--text-secondary);
  }

  /* engaged state */
  .checkbox-label input[type="checkbox"]:checked + .toggle-track {
    border-color: var(--accent-primary);
    background: rgba(0, 212, 255, 0.06);
  }

  .checkbox-label input[type="checkbox"]:checked + .toggle-track::before {
    background: linear-gradient(
      90deg,
      rgba(0, 212, 255, 0.03) 0%,
      rgba(0, 212, 255, 0.08) 100%
    );
  }

  /* slider slides right when engaged */
  .checkbox-label input[type="checkbox"]:checked + .toggle-track::after {
    left: 18px;
    background: var(--accent-primary);
    box-shadow:
      0 0 6px var(--accent-primary),
      0 0 12px rgba(0, 212, 255, 0.3);
  }

  /* focus ring */
  .checkbox-label input[type="checkbox"]:focus-visible + .toggle-track {
    outline: 1px solid var(--accent-primary);
    outline-offset: 2px;
  }

  /* switch label text */
  .toggle-label-text {
    color: var(--text-dim);
    font-size: 0.6rem;
    font-weight: 600;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    transition: color var(--transition-fast);
    line-height: 1;
  }

  .checkbox-label:hover .toggle-label-text {
    color: var(--text-secondary);
  }

  .checkbox-label input[type="checkbox"]:checked ~ .toggle-label-text {
    color: var(--accent-primary);
    text-shadow: 0 0 8px rgba(0, 212, 255, 0.3);
  }

  /* status pip next to label */
  .toggle-label-text::before {
    content: "";
    display: inline-block;
    width: 4px;
    height: 4px;
    margin-right: 6px;
    background: var(--text-dim);
    vertical-align: middle;
    transition: all var(--transition-fast);
  }

  .checkbox-label input[type="checkbox"]:checked ~ .toggle-label-text::before {
    background: var(--accent-primary);
    box-shadow: 0 0 4px var(--accent-primary);
  }

  /* agent keys */

  .agent-keys-panel {
    padding: 0.3rem 0.5rem;
  }

  .agent-status {
    font-size: 0.6rem;
    font-weight: 600;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    margin-bottom: 0.3rem;
  }

  .agent-status-ok {
    color: var(--accent-success);
  }

  .agent-status-warn {
    color: var(--accent-warning);
  }

  .agent-keys-list {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .agent-key-item {
    display: flex;
    gap: 0.5rem;
    align-items: baseline;
    font-size: 0.6rem;
    padding: 0.2rem 0;
    border-left: 2px solid var(--hud-line);
    padding-left: 0.5rem;
  }

  .agent-key-type {
    color: var(--accent-primary);
    font-weight: 600;
    letter-spacing: 0.08em;
    flex-shrink: 0;
  }

  .agent-key-fp {
    color: var(--text-dim);
    font-family: inherit;
    font-variant-numeric: tabular-nums;
  }

  .agent-key-comment {
    color: var(--text-secondary);
    font-style: italic;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* ---- status ---- */

  .status-panel {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    position: relative;
    overflow: hidden;
    min-height: 180px;
  }

  .status-row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .status-value {
    color: var(--text-primary);
    font-size: 0.8rem;
    display: flex;
    align-items: center;
    gap: 0.4rem;
    font-variant-numeric: tabular-nums;
  }

  /* stat bars */
  .stat-row-bar {
    display: flex;
    flex-direction: column;
    gap: 3px;
    padding: 2px 0;
  }

  .stat-row-bar .stat-row-header {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .stat-bar {
    width: 100%;
    height: 4px;
    background: rgba(0, 212, 255, 0.06);
    border: 1px solid rgba(0, 212, 255, 0.1);
    overflow: hidden;
  }

  .stat-bar-fill {
    height: 100%;
    min-width: 2px;
    transition: width var(--transition-smooth), background-color var(--transition-normal);
  }

  .stat-bar-fill.stat-nominal {
    background: var(--accent-success);
    box-shadow: 0 0 4px var(--accent-success);
  }
  .stat-bar-fill.stat-caution {
    background: var(--accent-warning);
    box-shadow: 0 0 4px var(--accent-warning);
  }
  .stat-bar-fill.stat-critical {
    background: var(--accent-secondary);
    box-shadow: 0 0 6px var(--accent-secondary);
    animation: glow-pulse 1.5s ease-in-out infinite;
  }
  .stat-bar-fill.stat-empty {
    background: transparent;
    width: 0% !important;
  }

  .text-secondary {
    color: var(--text-secondary);
    font-size: 0.75rem;
  }

  /* placeholder text for idle instruments */
  .stat-placeholder {
    color: var(--text-dim);
    opacity: 0.4;
    letter-spacing: 0.2em;
  }

  /* ---- scanline overlay ---- */

  .scanline-overlay {
    position: absolute;
    inset: 0;
    pointer-events: none;
    z-index: 2;
    overflow: hidden;
    opacity: 0;
    transition: opacity 0.3s ease;
  }

  /* the moving scanline band */
  .scanline-overlay::before {
    content: "";
    position: absolute;
    left: 0;
    right: 0;
    height: 3px;
    background: linear-gradient(
      180deg,
      transparent,
      rgba(0, 212, 255, 0.15),
      rgba(0, 212, 255, 0.3),
      rgba(0, 212, 255, 0.15),
      transparent
    );
    box-shadow: 0 0 12px rgba(0, 212, 255, 0.2);
    animation: scanline-sweep 1.8s linear infinite;
  }

  /* static noise grain */
  .scanline-overlay::after {
    content: "";
    position: absolute;
    inset: 0;
    background-image:
      repeating-linear-gradient(
        0deg,
        transparent 0px,
        transparent 2px,
        rgba(0, 212, 255, 0.03) 2px,
        rgba(0, 212, 255, 0.03) 4px
      );
    animation: static-noise 0.15s steps(3) infinite;
  }

  /* ---- signal text styles ---- */

  .signal-text {
    font-size: 0.75rem;
    font-weight: 600;
    letter-spacing: 0.12em;
  }

  .signal-scanning {
    color: var(--accent-primary);
    animation: signal-blink 1s steps(2) infinite;
  }

  .signal-locked {
    color: var(--accent-success);
    animation: signal-lock 0.4s ease-out both;
  }

  .signal-failed {
    color: var(--accent-secondary);
    animation: signal-glitch 0.3s ease-out both;
    text-shadow: 0 0 8px rgba(232, 37, 78, 0.4);
  }

  /* ---- stat bar noise (during scanning) ---- */

  .stat-bar-noise {
    height: 100%;
    width: 100%;
    background: linear-gradient(
      90deg,
      transparent 0%,
      rgba(0, 212, 255, 0.15) 20%,
      transparent 25%,
      rgba(0, 212, 255, 0.1) 40%,
      transparent 50%,
      rgba(0, 212, 255, 0.2) 65%,
      transparent 75%,
      rgba(0, 212, 255, 0.1) 90%,
      transparent 100%
    );
    background-size: 200% 100%;
    animation: noise-scroll 0.8s linear infinite;
  }

  /* ---- instrument rows (staggered flicker on lock) ---- */

  .stat-instrument {
    transition: opacity 0.2s ease;
  }

  /* when stats arrive, each row flickers in */
  .status-panel-locked .stat-instrument-live {
    animation: signal-lock 0.35s ease-out both;
  }

  /* ---- panel states ---- */

  /* idle - quiet, waiting */
  .status-panel-idle {
    border-color: var(--border-subtle);
  }

  .status-panel-idle .scanline-overlay {
    opacity: 0;
  }

  /* scanning - alive and searching */
  .status-panel-scanning {
    border-color: var(--border-active) !important;
    box-shadow: 0 0 16px rgba(0, 212, 255, 0.08);
    animation: panel-scan-pulse 2s ease-in-out infinite;
  }

  .status-panel-scanning .scanline-overlay {
    opacity: 1;
  }

  .status-panel-scanning .stat-placeholder {
    animation: static-noise 0.2s steps(4) infinite;
  }

  /* locked - signal acquired, instruments reading */
  .status-panel-locked {
    border-color: rgba(34, 197, 94, 0.25) !important;
    transition: border-color 0.5s ease, box-shadow 0.5s ease;
  }

  .status-panel-locked .scanline-overlay {
    opacity: 0;
  }

  /* failed - lost signal, red alert */
  .status-panel-failed {
    border-color: rgba(232, 37, 78, 0.35) !important;
    box-shadow: 0 0 12px rgba(232, 37, 78, 0.08);
  }

  .status-panel-failed .scanline-overlay {
    opacity: 0.6;
  }

  /* red-tinted scanline for failed state */
  .status-panel-failed .scanline-overlay::before {
    background: linear-gradient(
      180deg,
      transparent,
      rgba(232, 37, 78, 0.1),
      rgba(232, 37, 78, 0.2),
      rgba(232, 37, 78, 0.1),
      transparent
    );
    box-shadow: 0 0 12px rgba(232, 37, 78, 0.15);
    animation: scanline-sweep 2.5s linear infinite;
  }

  .status-panel-failed .scanline-overlay::after {
    background-image:
      repeating-linear-gradient(
        0deg,
        transparent 0px,
        transparent 2px,
        rgba(232, 37, 78, 0.03) 2px,
        rgba(232, 37, 78, 0.03) 4px
      );
  }

  /* ---- status panel keyframes ---- */

  @keyframes scanline-sweep {
    0% { top: -3px; }
    100% { top: 100%; }
  }

  @keyframes static-noise {
    0% { opacity: 0.4; clip-path: inset(0 0 0 0); }
    33% { opacity: 0.7; clip-path: inset(5% 0 10% 0); }
    66% { opacity: 0.3; clip-path: inset(15% 0 5% 0); }
    100% { opacity: 0.5; clip-path: inset(0 0 0 0); }
  }

  @keyframes signal-lock {
    0% { opacity: 0.3; filter: brightness(2); }
    30% { opacity: 1; filter: brightness(1.5); }
    50% { opacity: 0.6; filter: brightness(0.8); }
    70% { opacity: 1; filter: brightness(1.2); }
    100% { opacity: 1; filter: brightness(1); }
  }

  @keyframes signal-blink {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.3; }
  }

  @keyframes signal-glitch {
    0% { transform: translateX(0); opacity: 0; }
    15% { transform: translateX(-3px); opacity: 0.8; filter: hue-rotate(20deg); }
    30% { transform: translateX(2px); opacity: 0.5; }
    50% { transform: translateX(-1px); opacity: 1; }
    100% { transform: translateX(0); opacity: 1; filter: none; }
  }

  @keyframes noise-scroll {
    0% { background-position: 0% 0; }
    100% { background-position: 200% 0; }
  }

  @keyframes panel-scan-pulse {
    0%, 100% { box-shadow: 0 0 8px rgba(0, 212, 255, 0.04); }
    50% { box-shadow: 0 0 20px rgba(0, 212, 255, 0.1); }
  }

  /* ============================================
     command switches
     ============================================ */

  .command-panel {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.5rem;
  }

  .command-panel-label {
    color: var(--accent-secondary);
    font-size: 0.7rem;
    font-weight: 600;
    letter-spacing: 0.2em;
    text-transform: uppercase;
    text-shadow: 0 0 8px rgba(232, 37, 78, 0.4);
    animation: label-breathe 4s ease-in-out infinite;
  }

  @keyframes label-breathe {
    0%, 100% { opacity: 0.6; text-shadow: 0 0 6px rgba(232, 37, 78, 0.3); }
    50% { opacity: 1; text-shadow: 0 0 12px rgba(232, 37, 78, 0.5); }
  }

  .command-columns {
    display: flex;
    gap: 0.75rem;
  }

  .command-column {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.6rem;
  }

  .command-column-label {
    font-size: 0.6rem;
    font-weight: 600;
    letter-spacing: 0.15em;
    text-transform: uppercase;
    animation: sublabel-breathe 5s ease-in-out infinite;
  }

  .command-column:first-child .command-column-label {
    color: var(--accent-primary);
    text-shadow: 0 0 6px rgba(0, 212, 255, 0.3);
  }

  .command-column:last-child .command-column-label {
    color: #8ccc26;
    text-shadow: 0 0 6px rgba(140, 204, 38, 0.3);
  }

  @keyframes sublabel-breathe {
    0%, 100% { opacity: 0.6; }
    50% { opacity: 0.9; }
  }

  .cmd-switch {
    width: 72px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.35rem;
    padding: 0.7rem 0.5rem 0.6rem;
    background: var(--bg-terminal);
    border: 1.5px solid var(--border-subtle);
    border-left: 3px solid var(--hud-line);
    cursor: pointer;
    position: relative;
    transition: all var(--transition-fast);
    clip-path: polygon(
      0 0,
      calc(100% - 6px) 0,
      100% 6px,
      100% 100%,
      6px 100%,
      0 calc(100% - 6px)
    );
  }

  .cmd-switch:hover:not(:disabled) {
    border-color: var(--accent-primary);
    border-left-color: var(--accent-primary);
    background: rgba(0, 212, 255, 0.04);
    box-shadow: 0 0 12px rgba(0, 212, 255, 0.08);
  }

  .cmd-switch:active:not(:disabled) {
    background: rgba(0, 212, 255, 0.1);
    transform: scale(0.97);
  }

  .cmd-switch:disabled {
    cursor: not-allowed;
    opacity: 0.6;
  }

  .cmd-switch-missing {
    border-left-color: var(--accent-secondary);
  }

  .cmd-switch-missing .cmd-switch-sub {
    color: var(--accent-secondary);
  }

  /* status led */
  .cmd-switch-indicator {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--text-dim);
    box-shadow: 0 0 4px transparent;
    transition: all var(--transition-normal);
    flex-shrink: 0;
  }

  .cmd-switch-indicator.indicator-green {
    background: var(--accent-success);
    box-shadow: 0 0 8px var(--accent-success), 0 0 16px rgba(34, 197, 94, 0.3);
  }

  .cmd-switch-indicator.indicator-cyan {
    background: var(--accent-primary);
    box-shadow: 0 0 8px var(--accent-primary), 0 0 16px rgba(0, 212, 255, 0.3);
  }

  .cmd-switch-indicator.indicator-pulse {
    animation: led-pulse 1s ease-in-out infinite;
  }

  .cmd-switch-label {
    color: var(--text-primary);
    font-size: 0.75rem;
    font-weight: 700;
    letter-spacing: 0.15em;
    line-height: 1;
  }

  .cmd-switch-sub {
    color: var(--text-dim);
    font-size: 0.45rem;
    font-weight: 600;
    letter-spacing: 0.2em;
    line-height: 1;
  }

  /* active */
  .cmd-switch-active {
    border-color: var(--accent-primary) !important;
    border-left-color: var(--accent-primary) !important;
    background: rgba(0, 212, 255, 0.06);
    box-shadow: 0 0 16px rgba(0, 212, 255, 0.1);
  }

  /* probe came back green */
  .cmd-switch-success {
    border-color: rgba(34, 197, 94, 0.4);
    border-left-color: var(--accent-success);
  }

  /* cli gets the highlight */
  .cmd-switch-primary {
    border-left-color: var(--accent-primary);
  }

  /* locked - not yet */
  .cmd-switch-locked {
    opacity: 0.35;
  }

  .cmd-switch-lock {
    position: absolute;
    bottom: 2px;
    left: 50%;
    transform: translateX(-50%);
    font-size: 0.35rem;
    font-weight: 700;
    letter-spacing: 0.15em;
    color: var(--accent-secondary);
    opacity: 0.8;
  }

  .cmd-switch-local {
    border-left-color: #8ccc26;
  }

  .cmd-switch-local:hover:not(:disabled) {
    border-color: #8ccc26;
    border-left-color: #8ccc26;
    background: rgba(140, 204, 38, 0.04);
    box-shadow: 0 0 12px rgba(140, 204, 38, 0.08);
  }

  .cmd-switch-local:active:not(:disabled) {
    background: rgba(140, 204, 38, 0.1);
  }

  @keyframes led-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }

  /* ---- error ---- */

  .error-msg {
    color: var(--accent-secondary);
    font-size: 0.75rem;
    text-align: center;
    max-width: 100%;
    word-break: break-word;
    text-shadow: 0 0 8px rgba(232, 37, 78, 0.3);
  }

  /* ---- last session ---- */

  .last-session {
    color: var(--text-dim);
    font-size: 0.65rem;
    letter-spacing: 0.05em;
  }

  /* ---- passphrase ---- */

  .passphrase-panel {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    border-color: var(--accent-primary);
    animation: passphrase-glow 1.5s ease-in-out infinite alternate;
    width: 100%;
  }

  .passphrase-panel input {
    text-align: center;
    letter-spacing: 0.15em;
  }

  .passphrase-hint {
    color: var(--text-secondary);
    font-size: 0.7rem;
    margin: 0;
    text-align: center;
  }

  .passphrase-buttons {
    display: flex;
    gap: 0.5rem;
    margin-top: 0.25rem;
  }

  .passphrase-buttons .btn {
    flex: 1;
  }

  @keyframes passphrase-glow {
    from { box-shadow: 0 0 8px rgba(0, 212, 255, 0.05); }
    to   { box-shadow: 0 0 16px rgba(0, 212, 255, 0.12); }
  }
</style>
