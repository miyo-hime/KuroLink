import { useEffect } from "react";

interface ShortcutHandlers {
  onNextTab: () => void;
  onPrevTab: () => void;
  onCloseTab: () => void;
  onReopenTab: () => void;
  onGoToTab: (index: number) => void;
}

/**
 * global keyboard shortcuts for tab management.
 * registers on window so they work even when xterm has focus
 * (xterm's custom key handler must let these through)
 */
export function useKeyboardShortcuts(handlers: ShortcutHandlers) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // ctrl+tab / ctrl+shift+tab - next/prev tab
      if (e.ctrlKey && e.key === "Tab") {
        e.preventDefault();
        if (e.shiftKey) {
          handlers.onPrevTab();
        } else {
          handlers.onNextTab();
        }
        return;
      }

      // ctrl+shift+w - close tab (not ctrl+w, that conflicts with vim/shells)
      if (e.ctrlKey && e.shiftKey && e.code === "KeyW") {
        e.preventDefault();
        handlers.onCloseTab();
        return;
      }

      // ctrl+shift+t - reopen last closed tab
      if (e.ctrlKey && e.shiftKey && e.code === "KeyT") {
        e.preventDefault();
        handlers.onReopenTab();
        return;
      }

      // ctrl+1-9 - jump to tab by index
      if (e.ctrlKey && !e.shiftKey && !e.altKey) {
        const digit = e.code.match(/^Digit([1-9])$/);
        if (digit) {
          e.preventDefault();
          handlers.onGoToTab(parseInt(digit[1], 10) - 1);
          return;
        }
      }
    };

    window.addEventListener("keydown", onKeyDown, true); // capture phase
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [handlers]);
}
