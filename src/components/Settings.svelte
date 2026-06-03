<script lang="ts">
  import { onMount } from "svelte";
  import { appearance } from "../lib/appearance.svelte";
  import { PRESETS, FONT_OPTIONS, CURSOR_STYLE_OPTIONS, type ColorKey } from "../lib/themes";
  import { DEFAULT_LOCAL_SHELLS, type LocalShellId } from "../lib/types";
  import { rgbToHex, hexToRgb } from "../lib/colorHex";
  import {
    contextMenuStatus,
    registerContextMenu,
    unregisterContextMenu,
    type ContextMenuStatus,
  } from "../lib/ipc";

  const MIN_SIZE = 10;
  const MAX_SIZE = 24;

  let menuStatus = $state<ContextMenuStatus | null>(null);
  let menuBusy = $state(false);

  async function refreshMenuStatus() {
    try {
      menuStatus = await contextMenuStatus();
    } catch {
      menuStatus = null;
    }
  }
  onMount(refreshMenuStatus);

  async function toggleContextMenu() {
    if (menuBusy) return;
    menuBusy = true;
    try {
      if (menuStatus?.registered) await unregisterContextMenu();
      else await registerContextMenu();
      await refreshMenuStatus();
    } catch (e) {
      console.error("context menu toggle failed:", e);
    } finally {
      menuBusy = false;
    }
  }

  // exe moved out from under a stale registration - rewrite the keys to point at where
  // we actually live now
  async function relinkContextMenu() {
    if (menuBusy) return;
    menuBusy = true;
    try {
      await registerContextMenu();
      await refreshMenuStatus();
    } catch (e) {
      console.error("context menu relink failed:", e);
    } finally {
      menuBusy = false;
    }
  }

  let a = $derived(appearance.active);

  const COLOR_SWATCHES: { key: ColorKey; label: string }[] = [
    { key: "foreground", label: "TEXT" },
    { key: "cursor", label: "CURSOR" },
    { key: "red", label: "RED" },
    { key: "green", label: "GREEN" },
    { key: "yellow", label: "YELLOW" },
    { key: "blue", label: "BLUE" },
    { key: "magenta", label: "MAGENTA" },
    { key: "cyan", label: "CYAN" },
  ];

  const VIBRANCY: { id: "acrylic" | "blur" | "none"; label: string }[] = [
    { id: "acrylic", label: "ACRYLIC" },
    { id: "blur", label: "BLUR" },
    { id: "none", label: "SOLID" },
  ];

  function swatchValue(key: ColorKey): string {
    if (key === "foreground") return a.ghostty.foreground;
    if (key === "cursor") return a.ghostty.cursor;
    return (a.ghostty as unknown as Record<string, string>)[key];
  }

  function setSize(n: number) {
    appearance.setOverride({ fontSize: Math.max(MIN_SIZE, Math.min(MAX_SIZE, n)) });
  }
</script>

<svelte:window onkeydown={(e) => e.key === "Escape" && appearance.closeSettings()} />

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="settings-backdrop" onclick={() => appearance.closeSettings()}>
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="settings-drawer" onclick={(e) => e.stopPropagation()}>
    <div class="settings-head">
      <span class="settings-title">APPEARANCE</span>
      <span class="settings-sub">// recolor the cockpit</span>
      <button class="settings-close" onclick={() => appearance.closeSettings()} aria-label="Close" title="Close (Esc)">
        &#x2715;
      </button>
    </div>

    <div class="settings-scroll">
      <!-- live preview - faithful: same tint, font, palette, and effects as the
           real terminal, so what you see here is what you'll get there -->
      <div class="preview hud-frame" style="font-family: {a.fontStack}; font-size: {a.fontSize}px;">
        <span class="hud-frame-label">LIVE PREVIEW</span>
        <div
          class="preview-screen-wrap"
          class:fx-scanlines={a.effects.scanlines}
          class:fx-vignette={a.effects.vignette}
          class:fx-glow={a.effects.glow}
          style="background: {a.tint}; color: {a.ghostty.foreground};"
        >
          <pre class="preview-screen"><span style="color:{a.ghostty.cyan}">user@host</span>:<span style="color:{a.ghostty.green}">~/project</span>$ ls -la
<span style="color:{a.ghostty.blue}">drwxr-xr-x</span>  <span style="color:{a.ghostty.cyan}">src/</span>
<span style="color:{a.ghostty.blue}">drwxr-xr-x</span>  <span style="color:{a.ghostty.cyan}">build/</span>
<span style="color:{a.ghostty.black}">-rw-r--r--</span>  README.md
<span style="color:{a.ghostty.black}">-rwxr-xr-x</span>  <span style="color:{a.ghostty.green}">run.sh</span>
<span style="color:{a.ghostty.cyan}">user@host</span>:<span style="color:{a.ghostty.green}">~/project</span>$ git status
On branch <span style="color:{a.ghostty.cyan}">main</span>
<span style="color:{a.ghostty.green}">nothing to commit, working tree clean</span>
<span style="color:{a.ghostty.cyan}">user@host</span>:<span style="color:{a.ghostty.green}">~/project</span>$ ./run.sh --port 8080
listening on :<span style="color:{a.ghostty.magenta}">8080</span>
<span style="color:{a.ghostty.cyan}">user@host</span>:<span style="color:{a.ghostty.green}">~/project</span>$ cat config.toml
<span style="color:{a.ghostty.red}">error</span>: no such file or directory
<span style="color:{a.ghostty.cyan}">user@host</span>:<span style="color:{a.ghostty.green}">~/project</span>$ <span class="preview-cur cursor-{a.cursorStyle}" style="background:{a.ghostty.cursor}"></span></pre>
        </div>
      </div>

      <!-- presets -->
      <div class="section">
        <div class="section-label">PRESET <span class="section-hint">starting point, then tweak below</span></div>
        <div class="preset-grid">
          {#each PRESETS as p (p.id)}
            <button
              class="preset-card {appearance.presetId === p.id ? 'preset-active' : ''}"
              onclick={() => appearance.selectPreset(p.id)}
            >
              <div class="preset-name">{p.name}</div>
              <div class="preset-blurb">{p.blurb}</div>
              <div class="preset-swatches">
                <span class="sw" style="background: rgb({p.accentRgb})"></span>
                <span class="sw" style="background: {p.ghostty.red}"></span>
                <span class="sw" style="background: {p.ghostty.green}"></span>
                <span class="sw" style="background: {p.ghostty.yellow}"></span>
                <span class="sw" style="background: {p.ghostty.blue}"></span>
                <span class="sw" style="background: {p.ghostty.magenta}"></span>
                <span class="sw" style="background: {p.ghostty.cyan}"></span>
              </div>
            </button>
          {/each}
        </div>
      </div>

      <!-- terminal -->
      <div class="section">
        <div class="section-label">TERMINAL</div>

        <div class="ctrl-row">
          <span class="ctrl-label">FONT</span>
          <select
            class="ctrl-select"
            value={a.fontFamily}
            onchange={(e) => appearance.setOverride({ fontFamily: e.currentTarget.value })}
          >
            {#each FONT_OPTIONS as f (f)}
              <option value={f} style="font-family: '{f}', monospace">{f}</option>
            {/each}
          </select>
        </div>

        <div class="ctrl-row">
          <span class="ctrl-label">SIZE</span>
          <div class="stepper">
            <button class="step-btn" onclick={() => setSize(a.fontSize - 1)} aria-label="Smaller">&minus;</button>
            <span class="step-value tabular-nums">{a.fontSize}px</span>
            <button class="step-btn" onclick={() => setSize(a.fontSize + 1)} aria-label="Larger">+</button>
          </div>
        </div>

        <div class="ctrl-row">
          <span class="ctrl-label">CURSOR</span>
          <div class="seg">
            {#each CURSOR_STYLE_OPTIONS as c (c.id)}
              <button
                class="seg-btn {a.cursorStyle === c.id ? 'seg-active' : ''}"
                onclick={() => appearance.setOverride({ cursorStyle: c.id })}
              >
                {c.label}
              </button>
            {/each}
          </div>
        </div>

        <div class="ctrl-row">
          <span class="ctrl-label">GLASS</span>
          <input
            class="ctrl-range"
            type="range"
            min="0.2"
            max="1"
            step="0.02"
            value={a.tintAlpha}
            oninput={(e) => appearance.setOverride({ tintAlpha: parseFloat(e.currentTarget.value) })}
          />
          <span class="ctrl-readout tabular-nums">{Math.round(a.tintAlpha * 100)}%</span>
        </div>

        <div class="ctrl-row">
          <span class="ctrl-label">DEPTH</span>
          <div class="seg">
            {#each VIBRANCY as v (v.id)}
              <button
                class="seg-btn {a.vibrancy === v.id ? 'seg-active' : ''}"
                onclick={() => appearance.setOverride({ vibrancy: v.id })}
              >
                {v.label}
              </button>
            {/each}
          </div>
        </div>
      </div>

      <!-- effects -->
      <div class="section">
        <div class="section-label">EFFECTS</div>
        <div class="toggle-grid">
          <button
            class="fx-toggle {a.effects.scanlines ? 'fx-on' : ''}"
            onclick={() => appearance.setOverride({ effects: { scanlines: !a.effects.scanlines } })}
          >
            <span class="fx-pip"></span>SCANLINES
          </button>
          <button
            class="fx-toggle {a.effects.vignette ? 'fx-on' : ''}"
            onclick={() => appearance.setOverride({ effects: { vignette: !a.effects.vignette } })}
          >
            <span class="fx-pip"></span>VIGNETTE
          </button>
          <button
            class="fx-toggle {a.effects.glow ? 'fx-on' : ''}"
            onclick={() => appearance.setOverride({ effects: { glow: !a.effects.glow } })}
          >
            <span class="fx-pip"></span>GLOW
          </button>
        </div>
        <div class="fx-note">glow is an accent halo at the screen edge, not a per-glyph shimmer - the terminal renders text flat.</div>
      </div>

      <!-- palette -->
      <div class="section">
        <div class="section-label">PALETTE</div>
        <div class="swatch-grid">
          <label class="swatch">
            <input
              type="color"
              value={rgbToHex(a.accentRgb)}
              oninput={(e) => appearance.setOverride({ accentRgb: hexToRgb(e.currentTarget.value) })}
            />
            <span class="swatch-label">ACCENT</span>
          </label>
          {#each COLOR_SWATCHES as c (c.key)}
            <label class="swatch">
              <input
                type="color"
                value={swatchValue(c.key)}
                oninput={(e) => appearance.setOverride({ colors: { [c.key]: e.currentTarget.value } })}
              />
              <span class="swatch-label">{c.label}</span>
            </label>
          {/each}
        </div>
      </div>

      <!-- explorer integration -->
      <div class="section">
        <div class="section-label">EXPLORER <span class="section-hint">right-click a folder &rsaquo; open a shell there</span></div>
        <button
          class="ext-toggle {menuStatus?.registered ? 'ext-on' : ''}"
          onclick={toggleContextMenu}
          disabled={menuBusy}
        >
          <span class="ext-pip"></span>
          {menuStatus?.registered ? "OPEN KUROLINK HERE · ON" : "ADD 'OPEN KUROLINK HERE'"}
        </button>
        {#if menuStatus?.stale}
          <div class="ext-stale">
            kurolink moved since this was registered, so the menu points at the old spot.
            <button class="ext-relink" onclick={relinkContextMenu} disabled={menuBusy}>re-link</button>
          </div>
        {/if}
        <div class="fx-note">portable + no admin (writes your own user keys). on windows 11 it lives under "show more options".</div>

        <div class="ctrl-row">
          <span class="ctrl-label">SHELL</span>
          <select
            class="ctrl-select"
            value={appearance.launchShell}
            onchange={(e) => appearance.setLaunchShell(e.currentTarget.value as LocalShellId)}
          >
            {#each DEFAULT_LOCAL_SHELLS as s (s.id)}
              <option value={s.id}>{s.label}</option>
            {/each}
          </select>
        </div>
        <div class="fx-note">which shell a folder-open drops you into. falls back if it's not installed.</div>
      </div>

      <button class="reset-btn" onclick={() => appearance.resetOverrides()}>
        RESET TO PRESET
      </button>
    </div>
  </div>
</div>

<style>
  .settings-backdrop {
    position: fixed;
    inset: 0;
    z-index: 200;
    background: rgba(4, 4, 10, 0.55);
    backdrop-filter: blur(3px);
    display: flex;
    justify-content: flex-end;
    animation: fade-in 0.18s ease-out;
  }

  .settings-drawer {
    width: 560px;
    max-width: 92vw;
    height: 100%;
    display: flex;
    flex-direction: column;
    background: var(--bg-secondary);
    border-left: 1px solid var(--border-glow);
    box-shadow: -20px 0 60px rgba(0, 0, 0, 0.5);
    animation: drawer-in 0.22s cubic-bezier(0.4, 0, 0.2, 1);
  }

  @keyframes drawer-in {
    from { transform: translateX(40px); opacity: 0; }
    to { transform: translateX(0); opacity: 1; }
  }
  @keyframes fade-in {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  /* head */
  .settings-head {
    display: flex;
    align-items: baseline;
    gap: 0.6rem;
    padding: 0.85rem 1rem;
    border-bottom: 1px solid var(--border-subtle);
    flex-shrink: 0;
    position: relative;
  }
  .settings-head::after {
    content: "";
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    height: 1px;
    background: linear-gradient(90deg, transparent, var(--accent-primary) 50%, transparent);
  }
  .settings-title {
    color: var(--accent-primary);
    font-size: 0.85rem;
    font-weight: 700;
    letter-spacing: 0.22em;
    text-shadow: 0 0 10px rgba(var(--accent-rgb), 0.4);
  }
  .settings-sub {
    color: var(--text-dim);
    font-size: 0.62rem;
    letter-spacing: 0.05em;
  }
  .settings-close {
    margin-left: auto;
    background: none;
    border: 1px solid var(--border-subtle);
    color: var(--text-secondary);
    font-size: 0.75rem;
    padding: 0.15rem 0.45rem;
    cursor: pointer;
    transition: all var(--transition-fast);
  }
  .settings-close:hover {
    color: var(--accent-secondary);
    border-color: var(--accent-secondary);
  }

  .settings-scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 1rem;
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
  }

  /* preview */
  .preview {
    margin-top: 4px;
    overflow: hidden;
    position: relative;
  }
  .preview-screen-wrap {
    position: relative;
    overflow: hidden;
    padding: 0.6rem;
  }
  .preview-screen {
    margin: 0;
    position: relative;
    z-index: 1;
    font-family: inherit;
    line-height: 1.5;
    white-space: pre-wrap;
    word-break: break-word;
  }

  /* effects mirror the live terminal exactly: vignette darkens the edge, glow
     stacks an accent halo - the engine renders glyphs flat, so glow is edge-only,
     never a per-character shimmer - and scanlines overlay on top. */
  .preview-screen-wrap.fx-vignette::before,
  .preview-screen-wrap.fx-glow::before {
    content: "";
    position: absolute;
    inset: 0;
    pointer-events: none;
    z-index: 2;
  }
  .preview-screen-wrap.fx-vignette::before {
    box-shadow: inset 0 0 50px rgba(0, 0, 0, 0.55), inset 0 0 16px rgba(var(--accent-rgb), 0.06);
  }
  .preview-screen-wrap.fx-glow::before {
    box-shadow: inset 0 0 50px rgba(0, 0, 0, 0.4), inset 0 0 24px rgba(var(--accent-rgb), 0.14);
  }
  .preview-screen-wrap.fx-scanlines::after {
    content: "";
    position: absolute;
    inset: 0;
    pointer-events: none;
    z-index: 3;
    background: repeating-linear-gradient(0deg, transparent 0 2px, rgba(0, 0, 0, 0.12) 2px 3px);
  }
  .preview-cur {
    display: inline-block;
    width: 0.58em;
    height: 1.05em;
    vertical-align: text-bottom;
    animation: cur-blink 1.1s steps(1) infinite;
  }
  .preview-cur.cursor-bar {
    width: 0.12em;
  }
  .preview-cur.cursor-underline {
    width: 0.58em;
    height: 0.16em;
  }
  @keyframes cur-blink {
    50% { opacity: 0; }
  }

  /* sections */
  .section {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }
  .section-label {
    color: var(--text-label);
    font-size: 0.6rem;
    font-weight: 700;
    letter-spacing: 0.18em;
    border-bottom: 1px solid var(--border-subtle);
    padding-bottom: 0.35rem;
  }
  .section-hint {
    color: var(--text-dim);
    font-weight: 400;
    letter-spacing: 0.04em;
    text-transform: none;
    margin-left: 0.4rem;
  }

  /* preset cards */
  .preset-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.5rem;
  }
  .preset-card {
    text-align: left;
    background: var(--bg-terminal);
    border: 1px solid var(--border-subtle);
    border-left: 2px solid var(--hud-line);
    padding: 0.55rem 0.65rem;
    cursor: pointer;
    transition: all var(--transition-fast);
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }
  .preset-card:hover {
    border-color: var(--border-glow);
    border-left-color: var(--accent-primary);
    background: rgba(var(--accent-rgb), 0.03);
  }
  .preset-active {
    border-color: var(--accent-primary) !important;
    border-left-color: var(--accent-primary) !important;
    background: rgba(var(--accent-rgb), 0.07);
    box-shadow: inset 0 0 16px rgba(var(--accent-rgb), 0.06);
  }
  .preset-name {
    color: var(--text-primary);
    font-size: 0.75rem;
    font-weight: 700;
    letter-spacing: 0.06em;
  }
  .preset-blurb {
    color: var(--text-dim);
    font-size: 0.58rem;
    line-height: 1.35;
    min-height: 2.3em;
  }
  .preset-swatches {
    display: flex;
    gap: 3px;
    margin-top: 0.1rem;
  }
  .sw {
    width: 12px;
    height: 12px;
    border-radius: 1px;
  }

  /* controls */
  .ctrl-row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }
  .ctrl-label {
    color: var(--text-label);
    font-size: 0.6rem;
    font-weight: 600;
    letter-spacing: 0.14em;
    min-width: 52px;
  }
  .ctrl-select {
    flex: 1;
    background: var(--bg-terminal);
    color: var(--text-primary);
    border: 1px solid var(--border-subtle);
    border-left: 2px solid var(--hud-line);
    padding: 0.4rem 0.6rem;
    font-family: inherit;
    font-size: 0.78rem;
    outline: none;
    cursor: pointer;
  }
  .ctrl-select:focus {
    border-color: var(--accent-primary);
    border-left-color: var(--accent-primary);
  }

  .stepper {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .step-btn {
    width: 26px;
    height: 26px;
    background: var(--bg-terminal);
    border: 1px solid var(--border-subtle);
    color: var(--accent-primary);
    font-size: 0.9rem;
    cursor: pointer;
    transition: all var(--transition-fast);
  }
  .step-btn:hover {
    border-color: var(--accent-primary);
    background: rgba(var(--accent-rgb), 0.06);
  }
  .step-value {
    color: var(--text-primary);
    font-size: 0.78rem;
    min-width: 4ch;
    text-align: center;
  }

  .ctrl-range {
    flex: 1;
    accent-color: var(--accent-primary);
    cursor: pointer;
  }
  .ctrl-readout {
    color: var(--text-secondary);
    font-size: 0.72rem;
    min-width: 4ch;
    text-align: right;
  }

  /* segmented (vibrancy) */
  .seg {
    display: flex;
    flex: 1;
    border: 1px solid var(--border-subtle);
  }
  .seg-btn {
    flex: 1;
    background: var(--bg-terminal);
    border: none;
    border-right: 1px solid var(--border-subtle);
    color: var(--text-dim);
    font-family: inherit;
    font-size: 0.62rem;
    font-weight: 600;
    letter-spacing: 0.1em;
    padding: 0.4rem 0;
    cursor: pointer;
    transition: all var(--transition-fast);
  }
  .seg-btn:last-child {
    border-right: none;
  }
  .seg-btn:hover {
    color: var(--text-secondary);
    background: rgba(var(--accent-rgb), 0.04);
  }
  .seg-active {
    color: var(--accent-primary) !important;
    background: rgba(var(--accent-rgb), 0.1) !important;
    text-shadow: 0 0 6px rgba(var(--accent-rgb), 0.4);
  }

  /* effects toggles */
  .toggle-grid {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    gap: 0.5rem;
  }
  .fx-toggle {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.4rem;
    background: var(--bg-terminal);
    border: 1px solid var(--border-subtle);
    color: var(--text-dim);
    font-family: inherit;
    font-size: 0.6rem;
    font-weight: 600;
    letter-spacing: 0.1em;
    padding: 0.5rem 0;
    cursor: pointer;
    transition: all var(--transition-fast);
  }
  .fx-pip {
    width: 6px;
    height: 6px;
    background: var(--text-dim);
    transition: all var(--transition-fast);
  }
  .fx-toggle:hover {
    color: var(--text-secondary);
    border-color: var(--border-glow);
  }
  .fx-on {
    color: var(--accent-primary);
    border-color: var(--accent-primary);
    background: rgba(var(--accent-rgb), 0.06);
  }
  .fx-on .fx-pip {
    background: var(--accent-primary);
    box-shadow: 0 0 6px var(--accent-primary);
  }
  .fx-note {
    color: var(--text-dim);
    font-size: 0.58rem;
    line-height: 1.4;
    font-style: italic;
  }

  /* palette swatches */
  .swatch-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 0.5rem;
  }
  .swatch {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    cursor: pointer;
  }
  .swatch input[type="color"] {
    width: 28px;
    height: 24px;
    padding: 0;
    border: 1px solid var(--border-subtle);
    background: none;
    cursor: pointer;
  }
  .swatch input[type="color"]::-webkit-color-swatch-wrapper { padding: 2px; }
  .swatch input[type="color"]::-webkit-color-swatch { border: none; }
  .swatch-label {
    color: var(--text-secondary);
    font-size: 0.58rem;
    font-weight: 600;
    letter-spacing: 0.08em;
  }

  /* explorer integration toggle */
  .ext-toggle {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    background: var(--bg-terminal);
    border: 1px solid var(--border-subtle);
    border-left: 2px solid var(--hud-line);
    color: var(--text-secondary);
    font-family: inherit;
    font-size: 0.66rem;
    font-weight: 700;
    letter-spacing: 0.12em;
    padding: 0.6rem 0;
    cursor: pointer;
    transition: all var(--transition-fast);
  }
  .ext-toggle:hover:not(:disabled) {
    border-color: var(--border-glow);
    border-left-color: var(--accent-primary);
    background: rgba(var(--accent-rgb), 0.04);
  }
  .ext-toggle:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .ext-pip {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--text-dim);
    transition: all var(--transition-fast);
  }
  .ext-on {
    color: var(--accent-success);
    border-color: rgba(34, 197, 94, 0.4);
    border-left-color: var(--accent-success);
  }
  .ext-on .ext-pip {
    background: var(--accent-success);
    box-shadow: 0 0 8px var(--accent-success);
  }
  .ext-stale {
    color: var(--accent-warning);
    font-size: 0.6rem;
    line-height: 1.4;
  }
  .ext-relink {
    background: none;
    border: none;
    color: var(--accent-warning);
    font-family: inherit;
    font-size: 0.6rem;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-decoration: underline;
    cursor: pointer;
    padding: 0;
  }
  .ext-relink:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .reset-btn {
    align-self: flex-start;
    background: transparent;
    border: 1px solid var(--border-subtle);
    color: var(--text-secondary);
    font-family: inherit;
    font-size: 0.62rem;
    font-weight: 600;
    letter-spacing: 0.12em;
    padding: 0.45rem 0.9rem;
    cursor: pointer;
    transition: all var(--transition-fast);
  }
  .reset-btn:hover {
    color: var(--accent-warning);
    border-color: var(--accent-warning);
  }
</style>
