<script lang="ts">
  import type { Snippet } from "svelte";
  import type { Pane, PaneNode } from "../lib/types";
  import type { GraftSide } from "../lib/paneTree";
  import PaneTree from "./PaneTree.svelte";

  type DropHint = { paneId: string; side: GraftSide } | null;

  interface Props {
    node: PaneNode;
    activePaneId: string;
    tabVisible: boolean;
    multiPane: boolean;
    dropHint: DropHint;
    onFocusPane: (paneId: string) => void;
    onSetRatio: (splitId: string, ratio: number) => void;
    onClosePane: (paneId: string) => void;
    onDropHint: (hint: DropHint) => void;
    onGraftTab: (tabId: string, targetPaneId: string, side: GraftSide) => void;
    onOpenFilePane: (sessionId: string, path: string, targetPaneId: string, side: GraftSide) => void;
    // a pane's host identifier color ("r, g, b") or null - marks which host it's on
    paneColor: (pane: Pane) => string | null;
    // (pane, visible, focused, multiPane) -> the actual TerminalPanel/EditorPanel
    leaf: Snippet<[Pane, boolean, boolean, boolean]>;
  }

  let { node, activePaneId, tabVisible, multiPane, dropHint, paneColor, onFocusPane, onSetRatio, onClosePane, onDropHint, onGraftTab, onOpenFilePane, leaf }: Props = $props();

  const TAB_DRAG = "application/x-kurolink-tab";
  const FILE_DRAG = "application/x-kurolink-file";

  // a tab grafts beside the pane, a file opens as an editor beside it - both land the
  // same way, so they share the quadrant hint and only differ on drop.
  function graftKind(dt: DataTransfer | null): "tab" | "file" | null {
    if (dt?.types.includes(TAB_DRAG)) return "tab";
    if (dt?.types.includes(FILE_DRAG)) return "file";
    return null;
  }

  // cursor nearest edge -> the side the drop grafts onto, WT-style
  function edgeOf(e: DragEvent, el: HTMLElement): GraftSide {
    const r = el.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    const y = (e.clientY - r.top) / r.height;
    const d: Record<GraftSide, number> = { left: x, right: 1 - x, top: y, bottom: 1 - y };
    return (Object.keys(d) as GraftSide[]).reduce((best, k) => (d[k] < d[best] ? k : best), "right");
  }

  function onPaneDragOver(e: DragEvent, paneId: string) {
    const kind = graftKind(e.dataTransfer);
    if (!kind) return;
    e.preventDefault();
    e.dataTransfer!.dropEffect = kind === "tab" ? "move" : "copy";
    onDropHint({ paneId, side: edgeOf(e, e.currentTarget as HTMLElement) });
  }

  function onPaneDrop(e: DragEvent, paneId: string) {
    const kind = graftKind(e.dataTransfer);
    if (!kind) return;
    e.preventDefault();
    const side = edgeOf(e, e.currentTarget as HTMLElement);
    if (kind === "tab") {
      const tabId = e.dataTransfer!.getData(TAB_DRAG);
      if (tabId) onGraftTab(tabId, paneId, side);
    } else {
      const { sessionId, path } = JSON.parse(e.dataTransfer!.getData(FILE_DRAG));
      onOpenFilePane(sessionId, path, paneId, side);
    }
    onDropHint(null);
  }

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
  {@const hostRgb = paneColor(node.pane)}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="pane"
    class:pane-focused={tabVisible && node.pane.paneId === activePaneId}
    class:pane-tagged={hostRgb !== null}
    style={hostRgb ? `--host-rgb: ${hostRgb}` : ""}
    data-pane-id={node.pane.paneId}
    onpointerdowncapture={() => onFocusPane(node.pane.paneId)}
    ondragover={(e) => onPaneDragOver(e, node.pane.paneId)}
    ondrop={(e) => onPaneDrop(e, node.pane.paneId)}
  >
    {@render leaf(node.pane, tabVisible, tabVisible && node.pane.paneId === activePaneId, multiPane)}
    {#if dropHint && dropHint.paneId === node.pane.paneId}
      <div class="drop-hint drop-hint-{dropHint.side}"></div>
    {/if}
    {#if multiPane && node.pane.backend.kind !== "editor"}
      <button
        class="pane-close"
        title="Close pane"
        aria-label="Close pane"
        onpointerdown={(e) => e.stopPropagation()}
        onclick={() => onClosePane(node.pane.paneId)}
      >✕</button>
    {/if}
  </div>
{:else}
  <div class="pane-split pane-split-{node.dir}" bind:this={splitEl}>
    <div class="pane-slot" style="flex-grow: {node.ratio};">
      <PaneTree node={node.a} {activePaneId} {tabVisible} {multiPane} {dropHint} {paneColor} {onFocusPane} {onSetRatio} {onClosePane} {onDropHint} {onGraftTab} {onOpenFilePane} {leaf} />
    </div>
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="pane-divider pane-divider-{node.dir}"
      onpointerdown={(e) => startDrag(e, node.dir)}
    ></div>
    <div class="pane-slot" style="flex-grow: {1 - node.ratio};">
      <PaneTree node={node.b} {activePaneId} {tabVisible} {multiPane} {dropHint} {paneColor} {onFocusPane} {onSetRatio} {onClosePane} {onDropHint} {onGraftTab} {onOpenFilePane} {leaf} />
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

  /* the only mouse way out of a split - panes get no tab-strip X. hover-reveal. the
     editor pane opts out (it folds its own close into the toolbar) - see PaneTree leaf. */
  .pane-close {
    position: absolute;
    top: 4px;
    right: 4px;
    z-index: 16;
    width: 18px;
    height: 18px;
    display: grid;
    place-items: center;
    padding: 0;
    font-family: inherit;
    font-size: 0.7rem;
    line-height: 1;
    color: var(--text-dim);
    background: rgba(8, 8, 16, 0.7);
    border: 1px solid rgba(var(--accent-rgb), 0.3);
    cursor: pointer;
    opacity: 0;
    transition: opacity 0.12s ease, color 0.12s ease, border-color 0.12s ease;
    clip-path: polygon(0 0, calc(100% - 4px) 0, 100% 4px, 100% 100%, 4px 100%, 0 calc(100% - 4px));
  }

  .pane:hover .pane-close {
    opacity: 1;
  }

  .pane-close:hover {
    color: var(--accent-secondary);
    border-color: var(--accent-secondary);
  }

  /* drag-to-split landing zone. half the pane, on the edge the cursor's nearest. lives
     above the focus ring, pointer-events off so the drop still lands on .pane. */
  .drop-hint {
    position: absolute;
    z-index: 17;
    pointer-events: none;
    background: rgba(var(--accent-rgb), 0.18);
    box-shadow: inset 0 0 0 1px rgba(var(--accent-rgb), 0.65);
  }

  .drop-hint-left { inset: 0 50% 0 0; }
  .drop-hint-right { inset: 0 0 0 50%; }
  .drop-hint-top { inset: 0 0 50% 0; }
  .drop-hint-bottom { inset: 50% 0 0 0; }

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

  /* host identifier: a thin top edge + matching focus ring in the host's color, so a
     prod pane and a staging pane never blur together in a split. untagged panes stay neutral. */
  .pane-tagged::before {
    content: "";
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 2px;
    pointer-events: none;
    z-index: 15;
    background: rgb(var(--host-rgb));
    box-shadow: 0 0 6px rgba(var(--host-rgb), 0.5);
  }

  .pane-tagged.pane-focused::after {
    box-shadow: inset 0 0 0 1px rgba(var(--host-rgb), 0.65);
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
