import { commands } from "./commands.svelte";

// global key dispatch on window capture so it fires even while ghostty owns focus
// (ghostty's key handler returns true for these so they bubble up here). the palette
// toggle is the one hardwired chord - it has to work before any command exists, and
// it's also how you close the deck. left-hand summon: pinky+ring on ctrl/shift, thumb
// on space. everything else routes through the registry.
// returns its own teardown - call it from onMount's cleanup.
export function attachCommandKeys(): () => void {
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.ctrlKey && e.shiftKey && e.code === "Space") {
      e.preventDefault();
      commands.toggle();
      return;
    }
    if (commands.open) return;
    if (commands.dispatch(e)) e.preventDefault();
  };

  window.addEventListener("keydown", onKeyDown, true);
  return () => window.removeEventListener("keydown", onKeyDown, true);
}
