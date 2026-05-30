<script lang="ts">
  import { onMount } from "svelte";
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import { invoke } from "@tauri-apps/api/core";

  const appWindow = getCurrentWindow();
  let maximized = $state(false);
  let snapHovering = $state(false);
  let maxBtn = $state<HTMLButtonElement | null>(null);

  // hand the native side where our maximize button actually sits (physical px,
  // client-relative) so its WM_NCHITTEST subclass can serve the win11 snap flyout there
  function reportRect() {
    if (!maxBtn) return;
    const r = maxBtn.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    invoke("set_max_button_rect", {
      x: Math.round(r.left * dpr),
      y: Math.round(r.top * dpr),
      w: Math.round(r.width * dpr),
      h: Math.round(r.height * dpr),
    }).catch(() => {});
  }

  onMount(() => {
    const refresh = () => appWindow.isMaximized().then((m) => (maximized = m)).catch(() => {});
    refresh();
    reportRect();
    // fonts/layout can settle a frame or two late and shift the bar
    requestAnimationFrame(reportRect);
    const settle = setTimeout(reportRect, 120);

    const onResize = () => reportRect();
    window.addEventListener("resize", onResize);
    const unResized = appWindow.onResized(() => { refresh(); reportRect(); });
    const unHover = appWindow.listen<boolean>("kl://max-hover", (e) => (snapHovering = e.payload));

    return () => {
      clearTimeout(settle);
      window.removeEventListener("resize", onResize);
      unResized.then((f) => f());
      unHover.then((f) => f());
    };
  });
</script>

<div class="win-controls">
  <button
    class="win-btn"
    aria-label="Minimize"
    title="Minimize"
    onclick={() => appWindow.minimize()}
  >
    <svg class="win-glyph" viewBox="0 0 10 10" aria-hidden="true">
      <path d="M1 5 H9" />
    </svg>
  </button>

  <button
    class="win-btn"
    class:snap-hover={snapHovering}
    bind:this={maxBtn}
    aria-label={maximized ? "Restore" : "Maximize"}
    title={maximized ? "Restore" : "Maximize"}
    onclick={() => appWindow.toggleMaximize()}
  >
    <svg class="win-glyph" viewBox="0 0 10 10" aria-hidden="true">
      {#if maximized}
        <path d="M2.5 1 H9 V7.5 M0.5 2.5 H7.5 V9.5 H0.5 Z" />
      {:else}
        <rect x="1" y="1" width="8" height="8" />
      {/if}
    </svg>
  </button>

  <button
    class="win-btn win-btn-close"
    aria-label="Close"
    title="Close"
    onclick={() => appWindow.close()}
  >
    <svg class="win-glyph" viewBox="0 0 10 10" aria-hidden="true">
      <path d="M1 1 L9 9 M9 1 L1 9" />
    </svg>
  </button>
</div>

<style>
  .win-controls {
    display: flex;
    align-items: stretch;
    height: 100%;
    -webkit-app-region: no-drag;
  }

  .win-btn {
    width: 44px;
    display: grid;
    place-items: center;
    background: transparent;
    border: none;
    color: var(--text-secondary);
    cursor: pointer;
    transition: color var(--transition-fast), background var(--transition-fast);
  }

  .win-glyph {
    width: 10px;
    height: 10px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1;
    /* keep the strokes hairline-crisp no matter the viewBox scale */
    vector-effect: non-scaling-stroke;
  }

  .win-glyph rect {
    fill: none;
    stroke: currentColor;
  }

  /* :hover dies once the nc-hittest hands the maximize button to the os, so the
     native side drives .snap-hover to keep the button alive under the flyout */
  .win-btn:hover,
  .win-btn.snap-hover {
    color: var(--accent-primary);
    background: rgba(0, 212, 255, 0.08);
  }

  .win-btn:active {
    background: rgba(0, 212, 255, 0.14);
  }

  .win-btn-close:hover {
    color: var(--accent-secondary);
    background: rgba(232, 37, 78, 0.16);
  }

  /* the close button gets the house glitch - same energy as the disconnect view */
  .win-btn-close:hover .win-glyph {
    animation: ctrl-glitch 0.32s steps(2) 1;
    filter: drop-shadow(0 0 4px rgba(232, 37, 78, 0.6));
  }

  @keyframes ctrl-glitch {
    0% { transform: translate(0, 0); }
    25% { transform: translate(-1px, 1px); filter: hue-rotate(40deg); }
    50% { transform: translate(1px, -1px); }
    75% { transform: translate(-1px, 0); filter: hue-rotate(-30deg); }
    100% { transform: translate(0, 0); }
  }

  @media (prefers-reduced-motion: reduce) {
    .win-btn-close:hover .win-glyph { animation: none; }
  }
</style>
