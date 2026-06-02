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

export function mapPanes(node: PaneNode, fn: (p: Pane) => Pane): PaneNode {
  if (node.kind === "leaf") return { kind: "leaf", pane: fn(node.pane) };
  return { ...node, a: mapPanes(node.a, fn), b: mapPanes(node.b, fn) };
}

export function splitAt(
  node: PaneNode,
  targetPaneId: string,
  dir: "h" | "v",
  newPane: Pane,
  ratio = 0.5,
): PaneNode {
  if (node.kind === "leaf") {
    if (node.pane.paneId !== targetPaneId) return node;
    return {
      kind: "split",
      id: `split:${crypto.randomUUID()}`,
      dir,
      a: node,
      b: leafOf(newPane),
      ratio,
    };
  }
  return {
    ...node,
    a: splitAt(node.a, targetPaneId, dir, newPane, ratio),
    b: splitAt(node.b, targetPaneId, dir, newPane, ratio),
  };
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
