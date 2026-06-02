import type { SavedSession, SavedTabEntry, SavedPane, SavedTab } from "./types";

// blobs saved before 0.20.1 stored tabs as a flat SavedTab[] (one pane each). detect
// those - a SavedTab has a `kind`, a SavedTabEntry has a `layout` - and wrap them as
// single-leaf tabs so an old session still resumes after the upgrade.
function isLegacyEntry(e: unknown): e is SavedTab {
  return typeof e === "object" && e !== null && "kind" in e && !("layout" in e);
}

export function normalizeSession(raw: unknown): SavedSession | null {
  if (typeof raw !== "object" || raw === null || !Array.isArray((raw as SavedSession).tabs)) return null;
  const r = raw as { tabs: unknown[]; activeIndex?: number };
  const tabs: SavedTabEntry[] = r.tabs.map((e) =>
    isLegacyEntry(e) ? { layout: { kind: "leaf", backend: e }, activeLeaf: 0 } : (e as SavedTabEntry),
  );
  return { tabs, activeIndex: r.activeIndex ?? 0 };
}

export function savedLeaves(node: SavedPane): SavedTab[] {
  return node.kind === "leaf" ? [node.backend] : [...savedLeaves(node.a), ...savedLeaves(node.b)];
}
