interface ShortcutHandlers {
  onNextTab: () => void;
  onPrevTab: () => void;
  onCloseTab: () => void;
  onReopenTab: () => void;
  onGoToTab: (index: number) => void;
}

// global tab shortcuts on window so they fire even while ghostty owns focus
// (ghostty's custom key handler returns true for these so they bubble up here).
// returns its own teardown - call it from onMount's cleanup.
export function attachShortcuts(handlers: ShortcutHandlers): () => void {
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.ctrlKey && e.key === "Tab") {
      e.preventDefault();
      if (e.shiftKey) {
        handlers.onPrevTab();
      } else {
        handlers.onNextTab();
      }
      return;
    }

    // ctrl+shift+w, not ctrl+w - that one belongs to vim and the shells
    if (e.ctrlKey && e.shiftKey && e.code === "KeyW") {
      e.preventDefault();
      handlers.onCloseTab();
      return;
    }

    if (e.ctrlKey && e.shiftKey && e.code === "KeyT") {
      e.preventDefault();
      handlers.onReopenTab();
      return;
    }

    if (e.ctrlKey && !e.shiftKey && !e.altKey) {
      const digit = e.code.match(/^Digit([1-9])$/);
      if (digit) {
        e.preventDefault();
        handlers.onGoToTab(parseInt(digit[1], 10) - 1);
        return;
      }
    }
  };

  window.addEventListener("keydown", onKeyDown, true);
  return () => window.removeEventListener("keydown", onKeyDown, true);
}
