// ambient "which node was just created" flag the whole tree subtree reads, so a
// fresh file/folder can flash without drilling a prop through every recursive level.
export const HIGHLIGHT_KEY = Symbol("kl-tree-highlight");

export interface TreeHighlight {
  path: string | null;
}
