import { useEffect, useRef, useState } from "react";
import { Ghostty, Terminal, FitAddon, UrlRegexProvider } from "ghostty-web";
import { open } from "@tauri-apps/plugin-shell";
import { writeToShell, resizeShell, channelReady, onTerminalOutput, onTerminalClosed } from "../lib/ipc";
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
const MAX_INACTIVE_BUFFER_BYTES = 4 * 1024 * 1024;

const TERMINAL_THEME = {
  background: "#06060c",
  foreground: "#d8d8e4",
  cursor: "#00d4ff",
  cursorAccent: "#08080e",
  // ghostty solid-swaps both selection colors (no alpha), so we lean in: selection
  // = the same accent cyan as the cursor, text inverted to the bg. locked-on look.
  selectionBackground: "#00d4ff",
  selectionForeground: "#06060c",
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

// each panel gets its OWN wasm instance, not the shared init() singleton. sharing
// one instance across terminals bleeds a dead shell's freed cell memory into the
// next terminal's screen buffer - close a nushell/powershell tab, open ssh, and the
// old session ghosts through because ghostty_terminal_new doesn't zero what the
// allocator handed back. isolation = no shared memory = no ghost. (cmd was too
// trivial to leave visible residue, which is exactly how we caught it.)

export default function GhosttyPanel({ channelId, active, searchVisible, onSearchToggle, onClosed, onTitleChange }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const fontSizeRef = useRef(DEFAULT_FONT_SIZE);
  const activeRef = useRef(active);
  const pendingOutputRef = useRef<string[]>([]);
  const pendingOutputBytesRef = useRef(0);
  const resizeFrameRef = useRef<number | null>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [bellFlash, setBellFlash] = useState(false);

  // ghostty ships no search addon, so we roll our own on buffer.active. matches are
  // absolute buffer rows; they go stale if output streams mid-search, which is fine -
  // search is a momentary action and the next keystroke re-scans.
  const matchesRef = useRef<{ row: number; col: number }[]>([]);
  const matchIdxRef = useRef(-1);
  const queryLenRef = useRef(0);
  const [matchInfo, setMatchInfo] = useState<{ current: number; total: number } | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let disposed = false;
    let term: Terminal | null = null;
    const cleanups: Array<() => void> = [];

    Ghostty.load().then((ghostty) => {
      if (disposed || !container) return;

      term = new Terminal({
        ghostty,
        theme: TERMINAL_THEME,
        fontFamily: '"JetBrainsMono Nerd Font", "CaskaydiaCove Nerd Font", "FiraCode Nerd Font", "JetBrains Mono", "IBM Plex Mono", "Fira Code", "Cascadia Code", monospace',
        fontSize: DEFAULT_FONT_SIZE,
        cursorBlink: true,
        cursorStyle: "bar",
        scrollback: 10000,
      });

      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      term.open(container);

      // ghostty detects urls itself, but its default activation would navigate
      // the webview - hijack it to hand the uri to the OS browser instead
      const urlProvider = new UrlRegexProvider(term as never);
      term.registerLinkProvider({
        provideLinks(y, callback) {
          urlProvider.provideLinks(y, (links) => {
            callback(
              links?.map((link) => ({
                ...link,
                activate: (ev: MouseEvent) => {
                  ev.preventDefault();
                  open(link.text).catch(() => {});
                },
              })),
            );
          });
        },
      });

      termRef.current = term;
      fitRef.current = fitAddon;

      // heads up: ghostty inverts xterm's contract. here true = "swallow this key"
      // (it does preventDefault + bails), false = "let ghostty send it to the pty".
      // so we return true for keys we handle ourselves, false for normal typing.
      // preventDefault doesn't stop propagation, so the global-shortcut keys still
      // bubble to useKeyboardShortcuts on window.
      term.attachCustomKeyEventHandler((ev: KeyboardEvent) => {
        if (ev.type !== "keydown") return false;

        if (ev.ctrlKey && ev.key === "Tab") return true;
        if (ev.ctrlKey && !ev.shiftKey && ev.code.match(/^Digit[1-9]$/)) return true;
        if (ev.ctrlKey && ev.shiftKey && (ev.code === "KeyW" || ev.code === "KeyT")) return true;

        if (ev.ctrlKey && ev.shiftKey) {
          if (ev.code === "KeyC") {
            const sel = term!.getSelection();
            if (sel) navigator.clipboard.writeText(sel);
            return true;
          }
          if (ev.code === "KeyV") {
            navigator.clipboard.readText().then((text) => {
              if (text) writeToShell(channelId, text).catch(() => {});
            });
            return true;
          }
          if (ev.code === "KeyF") {
            onSearchToggle();
            return true;
          }
        }

        if (ev.ctrlKey && !ev.shiftKey && !ev.altKey) {
          if (ev.code === "Equal") {
            fontSizeRef.current = Math.min(MAX_FONT_SIZE, fontSizeRef.current + 1);
            term!.options.fontSize = fontSizeRef.current;
            fitAddon.fit();
            return true;
          }
          if (ev.code === "Minus") {
            fontSizeRef.current = Math.max(MIN_FONT_SIZE, fontSizeRef.current - 1);
            term!.options.fontSize = fontSizeRef.current;
            fitAddon.fit();
            return true;
          }
        }

        return false;
      });

      // keystrokes AND ghostty's own query replies (DA/DSR/DECRQM) both surface
      // here, so this one wire feeds the pty everything it needs. no CSI hack.
      const onDataDisposable = term.onData((data) => {
        writeToShell(channelId, data).catch(() => {});
      });

      const onResizeDisposable = term.onResize(({ cols, rows }) => {
        resizeShell(channelId, cols, rows).catch(() => {});
      });

      const onTitleDisposable = term.onTitleChange((title) => {
        onTitleChange?.(title);
      });

      const onBellDisposable = term.onBell(() => {
        setBellFlash(true);
        setTimeout(() => setBellFlash(false), 200);
      });

      const onSelectionDisposable = term.onSelectionChange(() => {
        const sel = term!.getSelection();
        if (sel) navigator.clipboard.writeText(sel).catch(() => {});
      });

      fitAddon.fit();

      let unlistenOutput: (() => void) | null = null;
      let unlistenClosed: (() => void) | null = null;

      onTerminalOutput(channelId, (data) => {
        if (activeRef.current) {
          term!.write(data);
        } else {
          pendingOutputRef.current.push(data);
          pendingOutputBytesRef.current += data.length;
          if (pendingOutputBytesRef.current >= MAX_INACTIVE_BUFFER_BYTES) {
            const pending = pendingOutputRef.current;
            pendingOutputRef.current = [];
            pendingOutputBytesRef.current = 0;
            term!.write(pending.join(""));
          }
        }
      }).then((fn) => {
        if (disposed) { fn(); return; }
        unlistenOutput = fn;
        channelReady(channelId).catch(() => {});
      });

      onTerminalClosed(channelId, () => {
        onClosed?.();
      }).then((fn) => {
        if (disposed) { fn(); return; }
        unlistenClosed = fn;
      });

      const resizeObserver = new ResizeObserver(() => {
        if (!activeRef.current || resizeFrameRef.current != null) return;
        resizeFrameRef.current = requestAnimationFrame(() => {
          resizeFrameRef.current = null;
          fitAddon.fit();
        });
      });
      resizeObserver.observe(container);

      const onContextMenu = (e: MouseEvent) => {
        e.preventDefault();
        navigator.clipboard.readText().then((text) => {
          if (text) writeToShell(channelId, text).catch(() => {});
        });
      };
      container.addEventListener("contextmenu", onContextMenu);

      cleanups.push(() => {
        container.removeEventListener("contextmenu", onContextMenu);
        onSelectionDisposable.dispose();
        resizeObserver.disconnect();
        onDataDisposable.dispose();
        onResizeDisposable.dispose();
        onTitleDisposable.dispose();
        onBellDisposable.dispose();
        unlistenOutput?.();
        unlistenClosed?.();
      });
    });

    return () => {
      disposed = true;
      if (resizeFrameRef.current != null) cancelAnimationFrame(resizeFrameRef.current);
      cleanups.forEach((fn) => { try { fn(); } catch { /* tearing down, who cares */ } });
      try { term?.dispose(); } catch { /* ditto */ }
      // ghostty flips isDisposed early but detaches the canvas last, so if its
      // teardown throws partway the canvas stays parented and a retry no-ops it -
      // an orphaned ghost terminal bleeding through the next tab. we own the
      // container, so just empty it and stop trusting dispose to finish the job.
      container.replaceChildren();
    };
  }, [channelId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    activeRef.current = active;
    if (!active) return;

    const frame = requestAnimationFrame(() => {
      fitRef.current?.fit();
      const pending = pendingOutputRef.current;
      if (pending.length > 0) {
        pendingOutputRef.current = [];
        pendingOutputBytesRef.current = 0;
        termRef.current?.write(pending.join(""));
      }
      termRef.current?.focus();
    });

    return () => cancelAnimationFrame(frame);
  }, [active]);

  useEffect(() => {
    if (searchVisible && searchInputRef.current) {
      searchInputRef.current.focus();
    }
    if (!searchVisible) {
      setSearchQuery("");
      setMatchInfo(null);
      matchesRef.current = [];
      matchIdxRef.current = -1;
      termRef.current?.clearSelection();
    }
  }, [searchVisible]);

  const highlightMatch = (i: number) => {
    const term = termRef.current;
    const m = matchesRef.current[i];
    if (!term || !m) return;
    term.clearSelection();
    term.select(m.col, m.row, queryLenRef.current);
    // drop the match near the middle of the viewport instead of pinning it to the top
    term.scrollToLine(Math.max(0, m.row - Math.floor(term.rows / 2)));
  };

  const navigate = (delta: number) => {
    const matches = matchesRef.current;
    if (matches.length === 0) return;
    let i = matchIdxRef.current + delta;
    if (i < 0) i = matches.length - 1;
    if (i >= matches.length) i = 0;
    matchIdxRef.current = i;
    highlightMatch(i);
    setMatchInfo({ current: i + 1, total: matches.length });
  };

  const runSearch = (query: string) => {
    setSearchQuery(query);
    const term = termRef.current;
    if (!term) return;

    queryLenRef.current = query.length;
    if (!query) {
      matchesRef.current = [];
      matchIdxRef.current = -1;
      term.clearSelection();
      setMatchInfo(null);
      return;
    }

    const needle = query.toLowerCase();
    const buf = term.buffer.active;
    const found: { row: number; col: number }[] = [];
    for (let y = 0; y < buf.length; y++) {
      const text = buf.getLine(y)?.translateToString(true).toLowerCase();
      if (!text) continue;
      for (let from = text.indexOf(needle); from !== -1; from = text.indexOf(needle, from + needle.length)) {
        found.push({ row: y, col: from });
      }
    }
    matchesRef.current = found;

    if (found.length === 0) {
      matchIdxRef.current = -1;
      term.clearSelection();
      setMatchInfo({ current: 0, total: 0 });
      return;
    }

    // land on the first hit at or below where we're already looking
    const viewTop = Math.floor(term.getViewportY());
    let start = found.findIndex((m) => m.row >= viewTop);
    if (start === -1) start = 0;
    matchIdxRef.current = start;
    highlightMatch(start);
    setMatchInfo({ current: start + 1, total: found.length });
  };

  const closeSearch = () => {
    onSearchToggle();
    termRef.current?.focus();
  };

  return (
    <div className={`terminal-wrapper ${active ? "terminal-active" : "terminal-hidden"} ${bellFlash ? "terminal-bell" : ""}`}>
      {searchVisible && (
        // ghostty has a click-outside-to-deselect handler on document. our nav
        // buttons set a selection then the click bubbles up and ghostty wipes it.
        // stop the bubble here so anything in the search bar leaves the highlight alone.
        <div className="terminal-search-bar" onClick={(e) => e.stopPropagation()}>
          <span className="terminal-search-label">find</span>
          <input
            ref={searchInputRef}
            className="terminal-search-input"
            placeholder="search..."
            value={searchQuery}
            onChange={(e) => runSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                navigate(e.shiftKey ? -1 : 1);
              }
              if (e.key === "Escape") closeSearch();
            }}
          />
          {matchInfo && (
            <span className={`terminal-search-count ${matchInfo.total === 0 ? "no-match" : ""}`}>
              {matchInfo.total === 0 ? "no results" : `${matchInfo.current}/${matchInfo.total}`}
            </span>
          )}
          {/* keep focus in the input on click so you can click an arrow then keep
              hitting Enter without re-focusing */}
          <button className="terminal-search-btn" onMouseDown={(e) => e.preventDefault()} onClick={() => navigate(-1)} title="Previous match">
            &#x25B2;
          </button>
          <button className="terminal-search-btn" onMouseDown={(e) => e.preventDefault()} onClick={() => navigate(1)} title="Next match">
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
