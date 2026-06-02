import type { Pane, PaneNode } from "./types";

// the tree is plain data; everything here is pure - hand it a node, get a new node
// back. MainView owns the state and reassigns from these so svelte's reactivity fires.

export function leafOf(pane: Pane): PaneNode {
  return { kind: "leaf", pane };
}

export function panesOf(node: PaneNode): Pane[] {
  if (node.kind === "leaf") return [node.pane];
  return [...panesOf(node.a), ...panesOf(node.b)];
}

export function findPane(node: PaneNode, paneId: string): Pane | null {
  if (node.kind === "leaf") return node.pane.paneId === paneId ? node.pane : null;
  return findPane(node.a, paneId) ?? findPane(node.b, paneId);
}

// identity-preserving on purpose: same node back when fn changed nothing under it. a
// re-titled shell mustn't mint a fresh node for its files-pane sibling, or that subtree
// re-renders and the file browser remounts mid-load, wiping the tree it just fetched.
export function mapPanes(node: PaneNode, fn: (p: Pane) => Pane): PaneNode {
  if (node.kind === "leaf") {
    const pane = fn(node.pane);
    return pane === node.pane ? node : { kind: "leaf", pane };
  }
  const a = mapPanes(node.a, fn);
  const b = mapPanes(node.b, fn);
  return a === node.a && b === node.b ? node : { ...node, a, b };
}

export type GraftSide = "left" | "right" | "top" | "bottom";

// graft a whole subtree beside the target leaf. ratio is the *grafted* subtree's share,
// so it reads the same no matter which side it lands on. drag-to-split rides this; splitAt
// is just the single-leaf case.
export function graftAt(
  node: PaneNode,
  targetPaneId: string,
  side: GraftSide,
  subtree: PaneNode,
  ratio = 0.5,
): PaneNode {
  if (node.kind === "leaf") {
    if (node.pane.paneId !== targetPaneId) return node;
    const dir = side === "left" || side === "right" ? "v" : "h";
    const before = side === "left" || side === "top";
    return {
      kind: "split",
      id: `split:${crypto.randomUUID()}`,
      dir,
      a: before ? subtree : node,
      b: before ? node : subtree,
      ratio: before ? ratio : 1 - ratio,
    };
  }
  return {
    ...node,
    a: graftAt(node.a, targetPaneId, side, subtree, ratio),
    b: graftAt(node.b, targetPaneId, side, subtree, ratio),
  };
}

// before=true puts the new pane in the leading slot, so ratio is *its* share.
export function splitAt(
  node: PaneNode,
  targetPaneId: string,
  dir: "h" | "v",
  newPane: Pane,
  ratio = 0.5,
  before = false,
): PaneNode {
  const side: GraftSide = dir === "v" ? (before ? "left" : "right") : before ? "top" : "bottom";
  return graftAt(node, targetPaneId, side, leafOf(newPane), before ? ratio : 1 - ratio);
}

// null means that was the last pane standing - the caller closes the whole tab.
export function removePane(node: PaneNode, paneId: string): PaneNode | null {
  if (node.kind === "leaf") return node.pane.paneId === paneId ? null : node;
  const a = removePane(node.a, paneId);
  const b = removePane(node.b, paneId);
  if (a === null) return b;
  if (b === null) return a;
  return { ...node, a, b };
}

export function setRatio(node: PaneNode, splitId: string, ratio: number): PaneNode {
  if (node.kind === "leaf") return node;
  if (node.id === splitId) return { ...node, ratio };
  return { ...node, a: setRatio(node.a, splitId, ratio), b: setRatio(node.b, splitId, ratio) };
}
