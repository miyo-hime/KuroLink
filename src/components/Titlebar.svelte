<script lang="ts">
  import WindowControls from "./WindowControls.svelte";
  import KuroLinkMark from "./KuroLinkMark.svelte";
  import SettingsButton from "./SettingsButton.svelte";
</script>

<div class="titlebar" data-tauri-drag-region>
  <div class="titlebar-brand" data-tauri-drag-region>
    <span class="titlebar-mark" data-tauri-drag-region><KuroLinkMark /></span>
    <span class="titlebar-name" data-tauri-drag-region>KUROLINK</span>
    <span class="titlebar-sep" data-tauri-drag-region></span>
    <span class="titlebar-sys" data-tauri-drag-region>
      <span class="indicator-diamond indicator-cyan indicator-pulse"></span>
      <span class="titlebar-sys-text">STANDBY</span>
    </span>
  </div>
  <SettingsButton />
  <span class="titlebar-divider"></span>
  <WindowControls />
</div>

<style>
  .titlebar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 34px;
    flex-shrink: 0;
    padding-left: 0.75rem;
    position: relative;
    z-index: 3;
    background: var(--bg-secondary);
    background-image:
      repeating-linear-gradient(0deg, var(--hud-grid) 0 1px, transparent 1px 20px),
      repeating-linear-gradient(90deg, var(--hud-grid) 0 1px, transparent 1px 20px);
    border-bottom: 1px solid var(--border-subtle);
  }

  /* bottom glow seam - matches the topbar's */
  .titlebar::after {
    content: "";
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    height: 1px;
    background: linear-gradient(
      90deg,
      transparent,
      var(--border-glow) 20%,
      var(--accent-primary) 50%,
      var(--border-glow) 80%,
      transparent
    );
  }

  .titlebar-brand {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    height: 100%;
    flex: 1;
    min-width: 0;
  }

  .titlebar-mark {
    display: flex;
    align-items: center;
    flex-shrink: 0;
  }

  .titlebar-name {
    color: var(--text-primary);
    font-size: 0.72rem;
    font-weight: 700;
    letter-spacing: 0.22em;
    text-shadow: 0 0 8px rgba(var(--accent-rgb), 0.25);
  }

  .titlebar-sep {
    width: 1px;
    height: 12px;
    background: var(--border-glow);
  }

  .titlebar-divider {
    width: 1px;
    height: 16px;
    align-self: center;
    background: var(--border-glow);
    margin: 0 0.3rem 0 0.1rem;
  }

  .titlebar-sys {
    display: flex;
    align-items: center;
    gap: 0.35rem;
  }

  .titlebar-sys-text {
    color: var(--text-label);
    font-size: 0.55rem;
    font-weight: 600;
    letter-spacing: 0.18em;
  }
</style>
