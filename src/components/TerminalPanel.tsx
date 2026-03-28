import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { SearchAddon } from "@xterm/addon-search";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { open } from "@tauri-apps/plugin-shell";
import "@xterm/xterm/css/xterm.css";
import { writeToShell, resizeShell, onTerminalOutput, onTerminalClosed } from "../lib/ipc";
import "./TerminalPanel.css";

interface Props {
  channelId: string;
  active: boolean;
  searchVisible: boolean;
  onSearchToggle: () => void;
  onClosed?: () => void;
  onTitleChange?: (title: string) => void;
}

const DEFAULT_FONT_SIZE = 14;
const MIN_FONT_SIZE = 10;
const MAX_FONT_SIZE = 24;

const TERMINAL_THEME = {
  background: "#06060c",
  foreground: "#d8d8e4",
  cursor: "#00d4ff",
  cursorAccent: "#08080e",
  selectionBackground: "rgba(0, 212, 255, 0.2)",
  black: "#08080e",
  red: "#e8254e",
  green: "#8ccc26",
  yellow: "#e8a800",
  blue: "#00a0ff",
  magenta: "#c850c0",
  cyan: "#00d4ff",
  white: "#d8d8e4",
  brightBlack: "#4a4a64",
  brightRed: "#ff4a6e",
  brightGreen: "#a0dd40",
  brightYellow: "#ffc830",
  brightBlue: "#40b8ff",
  brightMagenta: "#e070e0",
  brightCyan: "#40e8ff",
  brightWhite: "#ffffff",
};

export default function TerminalPanel({ channelId, active, searchVisible, onSearchToggle, onClosed, onTitleChange }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const searchRef = useRef<SearchAddon | null>(null);
  const fontSizeRef = useRef(DEFAULT_FONT_SIZE);

  // search bar
  const [searchQuery, setSearchQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);

  // visual bell
  const [bellFlash, setBellFlash] = useState(false);

  useEffect(() => {
    if (!containerRef.current) return;

    const term = new Terminal({
      theme: TERMINAL_THEME,
      fontFamily: '"JetBrains Mono", "IBM Plex Mono", "Fira Code", "Cascadia Code", monospace',
      fontSize: DEFAULT_FONT_SIZE,
      cursorBlink: true,
      cursorStyle: "bar",
      scrollback: 10000,
      allowProposedApi: true,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);

    // search
    const searchAddon = new SearchAddon();
    term.loadAddon(searchAddon);
    searchRef.current = searchAddon;

    // clickable links - open in system browser
    term.loadAddon(new WebLinksAddon((_ev, uri) => {
      open(uri).catch(() => {});
    }));

    term.open(containerRef.current);

    // webgl if we can, canvas if we can't
    try {
      const webglAddon = new WebglAddon();
      webglAddon.onContextLoss(() => webglAddon.dispose());
      term.loadAddon(webglAddon);
    } catch {
      // canvas it is
    }

    termRef.current = term;
    fitRef.current = fitAddon;

    // unified key handler - clipboard, zoom, search toggle
    term.attachCustomKeyEventHandler((ev: KeyboardEvent) => {
      if (ev.type !== "keydown") return true;

      // let global shortcuts bubble through to useKeyboardShortcuts
      if (ev.ctrlKey && ev.key === "Tab") return false;
      if (ev.ctrlKey && !ev.shiftKey && ev.code.match(/^Digit[1-9]$/)) return false;
      if (ev.ctrlKey && ev.shiftKey && (ev.code === "KeyW" || ev.code === "KeyT")) return false;

      // ctrl+shift combos
      if (ev.ctrlKey && ev.shiftKey) {
        if (ev.code === "KeyC") {
          const sel = term.getSelection();
          if (sel) navigator.clipboard.writeText(sel);
          return false;
        }
        if (ev.code === "KeyV") {
          navigator.clipboard.readText().then((text) => {
            if (text) writeToShell(channelId, text).catch(() => {});
          });
          return false;
        }
        if (ev.code === "KeyF") {
          onSearchToggle();
          return false;
        }
      }

      // ctrl + zoom (no shift)
      if (ev.ctrlKey && !ev.shiftKey && !ev.altKey) {
        if (ev.code === "Equal") {
          ev.preventDefault();
          fontSizeRef.current = Math.min(MAX_FONT_SIZE, fontSizeRef.current + 1);
          term.options.fontSize = fontSizeRef.current;
          fitAddon.fit();
          return false;
        }
        if (ev.code === "Minus") {
          ev.preventDefault();
          fontSizeRef.current = Math.max(MIN_FONT_SIZE, fontSizeRef.current - 1);
          term.options.fontSize = fontSizeRef.current;
          fitAddon.fit();
          return false;
        }
      }

      return true;
    });

    // keystrokes -> ssh
    const onDataDisposable = term.onData((data) => {
      writeToShell(channelId, data).catch(() => {});
    });

    // resize -> pty resize (must be registered BEFORE first fit()
    // so the initial size actually reaches the PTY)
    const onResizeDisposable = term.onResize(({ cols, rows }) => {
      resizeShell(channelId, cols, rows).catch(() => {});
    });

    // osc title changes -> tab title
    const onTitleDisposable = term.onTitleChange((title) => {
      onTitleChange?.(title);
    });

    // visual bell - brief cyan flash
    const onBellDisposable = term.onBell(() => {
      setBellFlash(true);
      setTimeout(() => setBellFlash(false), 200);
    });

    // now fit - this fires onResize with the real container dimensions
    fitAddon.fit();

    // ssh output -> terminal
    let unlistenOutput: (() => void) | null = null;
    let unlistenClosed: (() => void) | null = null;

    onTerminalOutput(channelId, (data) => {
      term.write(data);
    }).then((fn) => { unlistenOutput = fn; });

    onTerminalClosed(channelId, () => {
      onClosed?.();
    }).then((fn) => { unlistenClosed = fn; });

    // resize observer
    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit();
    });
    resizeObserver.observe(containerRef.current);

    // putty-style: select text = auto-copy
    const onSelectionDisposable = term.onSelectionChange(() => {
      const sel = term.getSelection();
      if (sel) navigator.clipboard.writeText(sel).catch(() => {});
    });

    // putty-style: right-click = paste
    const el = containerRef.current;
    const onContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      navigator.clipboard.readText().then((text) => {
        if (text) writeToShell(channelId, text).catch(() => {});
      });
    };
    el.addEventListener("contextmenu", onContextMenu);

    return () => {
      el.removeEventListener("contextmenu", onContextMenu);
      onSelectionDisposable.dispose();
      resizeObserver.disconnect();
      onDataDisposable.dispose();
      onResizeDisposable.dispose();
      onTitleDisposable.dispose();
      onBellDisposable.dispose();
      unlistenOutput?.();
      unlistenClosed?.();
      term.dispose();
    };
  }, [channelId]); // eslint-disable-line react-hooks/exhaustive-deps

  // re-fit on tab switch
  useEffect(() => {
    if (!active) return;

    const frame = requestAnimationFrame(() => {
      fitRef.current?.fit();
      termRef.current?.focus();
    });

    return () => cancelAnimationFrame(frame);
  }, [active]);

  // auto-focus search input when it appears, clear when it closes
  useEffect(() => {
    if (searchVisible && searchInputRef.current) {
      searchInputRef.current.focus();
    }
    if (!searchVisible) {
      setSearchQuery("");
      searchRef.current?.clearDecorations();
    }
  }, [searchVisible]);

  const doSearch = (direction: "next" | "prev") => {
    if (!searchRef.current || !searchQuery) return;
    if (direction === "next") {
      searchRef.current.findNext(searchQuery);
    } else {
      searchRef.current.findPrevious(searchQuery);
    }
  };

  const closeSearch = () => {
    onSearchToggle();
    termRef.current?.focus();
  };

  return (
    <div className={`terminal-wrapper ${active ? "terminal-active" : "terminal-hidden"} ${bellFlash ? "terminal-bell" : ""}`}>
      {searchVisible && (
        <div className="terminal-search-bar">
          <span className="terminal-search-label">find</span>
          <input
            ref={searchInputRef}
            className="terminal-search-input"
            placeholder="search..."
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              // live search as you type
              if (e.target.value) searchRef.current?.findNext(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.shiftKey ? doSearch("prev") : doSearch("next");
              }
              if (e.key === "Escape") closeSearch();
            }}
          />
          <button className="terminal-search-btn" onClick={() => doSearch("prev")} title="Previous match">
            &#x25B2;
          </button>
          <button className="terminal-search-btn" onClick={() => doSearch("next")} title="Next match">
            &#x25BC;
          </button>
          <button className="terminal-search-btn" onClick={closeSearch} title="Close search">
            &#x2715;
          </button>
        </div>
      )}

      <div className="terminal-inner" ref={containerRef} />
    </div>
  );
}
