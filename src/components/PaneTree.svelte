<script lang="ts">
  import type { Snippet } from "svelte";
  import type { Pane, PaneNode } from "../lib/types";
  import PaneTree from "./PaneTree.svelte";

  interface Props {
    node: PaneNode;
    activePaneId: string;
    tabVisible: boolean;
    onFocusPane: (paneId: string) => void;
    onSetRatio: (splitId: string, ratio: number) => void;
    // (pane, visible, focused) -> the actual TerminalPanel/EditorPanel
    leaf: Snippet<[Pane, boolean, boolean]>;
  }

  let { node, activePaneId, tabVisible, onFocusPane, onSetRatio, leaf }: Props = $props();

  let splitEl = $state<HTMLDivElement | null>(null);

  // clamp so a pane can't be dragged to nothing - ghostty can't fit a 0-col terminal.
  function startDrag(e: PointerEvent, dir: "h" | "v") {
    e.preventDefault();
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);

    const move = (ev: PointerEvent) => {
      if (!splitEl) return;
      const rect = splitEl.getBoundingClientRect();
      const r =
        dir === "v"
          ? (ev.clientX - rect.left) / rect.width
          : (ev.clientY - rect.top) / rect.height;
      onSetRatio((node as Extract<PaneNode, { kind: "split" }>).id, Math.min(0.9, Math.max(0.1, r)));
    };
    const up = (ev: PointerEvent) => {
      target.releasePointerCapture(ev.pointerId);
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", up);
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", up);
  }
</script>

{#if node.kind === "leaf"}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="pane"
    class:pane-focused={tabVisible && node.pane.paneId === activePaneId}
    data-pane-id={node.pane.paneId}
    onpointerdowncapture={() => onFocusPane(node.pane.paneId)}
  >
    {@render leaf(node.pane, tabVisible, tabVisible && node.pane.paneId === activePaneId)}
  </div>
{:else}
  <div class="pane-split pane-split-{node.dir}" bind:this={splitEl}>
    <div class="pane-slot" style="flex-grow: {node.ratio};">
      <PaneTree node={node.a} {activePaneId} {tabVisible} {onFocusPane} {onSetRatio} {leaf} />
    </div>
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="pane-divider pane-divider-{node.dir}"
      onpointerdown={(e) => startDrag(e, node.dir)}
    ></div>
    <div class="pane-slot" style="flex-grow: {1 - node.ratio};">
      <PaneTree node={node.b} {activePaneId} {tabVisible} {onFocusPane} {onSetRatio} {leaf} />
    </div>
  </div>
{/if}

<style>
  /* no backgrounds anywhere in this chain on purpose - the win11 acrylic has to reach
     the terminal canvas, and the terminal's own translucent tint does the frosting.
     paint anything opaque here and the glass bricks up. */
  .pane {
    position: relative;
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
  }

  /* the focused-pane ring. inset box-shadow, not border - no layout shift, and it
     rides over the canvas without stealing a pixel from the terminal. */
  .pane-focused::after {
    content: "";
    position: absolute;
    inset: 0;
    pointer-events: none;
    z-index: 15;
    box-shadow: inset 0 0 0 1px rgba(var(--accent-rgb), 0.55);
  }

  .pane-split {
    display: flex;
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
  }

  .pane-split-v { flex-direction: row; }
  .pane-split-h { flex-direction: column; }

  .pane-slot {
    flex-basis: 0;
    position: relative;
    min-width: 0;
    min-height: 0;
  }

  /* thin hairline, fat invisible grab zone. negative margins so the hit area overlaps
     the panes without pushing them around. */
  .pane-divider {
    position: relative;
    flex: 0 0 1px;
    background: var(--border-glow);
    z-index: 14;
  }

  .pane-divider::before {
    content: "";
    position: absolute;
    inset: 0;
  }

  .pane-divider-v {
    cursor: col-resize;
    margin: 0 -3px;
    padding: 0 3px;
    background-clip: content-box;
  }

  .pane-divider-h {
    cursor: row-resize;
    margin: -3px 0;
    padding: 3px 0;
    background-clip: content-box;
  }

  .pane-divider:hover {
    background: var(--accent-primary);
    box-shadow: 0 0 6px rgba(var(--accent-rgb), 0.5);
  }
</style>
