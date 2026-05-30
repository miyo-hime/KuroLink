<script lang="ts">
  import { onMount } from "svelte";
  import { Ghostty, Terminal, FitAddon, UrlRegexProvider } from "ghostty-web";
  import { open } from "@tauri-apps/plugin-shell";
  import { writeToShell, resizeShell, channelReady, onTerminalOutput, onTerminalClosed } from "../lib/ipc";

  interface Props {
    channelId: string;
    active: boolean;
    searchVisible: boolean;
    onSearchToggle: () => void;
    onClosed?: () => void;
    onTitleChange?: (title: string) => void;
  }

  let { channelId, active, searchVisible, onSearchToggle, onClosed, onTitleChange }: Props = $props();

  const DEFAULT_FONT_SIZE = 14;
  const MIN_FONT_SIZE = 10;
  const MAX_FONT_SIZE = 24;
  const MAX_INACTIVE_BUFFER_BYTES = 4 * 1024 * 1024;

  // bg is fully transparent so the canvas only shows the frost tint that lives on
  // .terminal-inner. ghostty was patched to clearRect before each fill (renderLine +
  // clear), otherwise the per-frame fillRect stacks alpha and the glass silts up opaque.
  // default-bg cells already skip their own fill, so they show the tint through cleanly.
  const TERMINAL_THEME = {
    background: "rgba(0, 0, 0, 0)",
    foreground: "#eef0fb",
    cursor: "#2ae0ff",
    cursorAccent: "#06060c",
    // ghostty solid-swaps both selection colors (no alpha), so we lean in: selection
    // = the same accent cyan as the cursor, text inverted to the bg. locked-on look.
    selectionBackground: "#2ae0ff",
    selectionForeground: "#06060c",
    black: "#08080e",
    red: "#ff2e6e",
    green: "#b6ff3a",
    yellow: "#ffd23a",
    blue: "#4aa8ff",
    magenta: "#ff5ad8",
    cyan: "#2ae0ff",
    white: "#eef0fb",
    brightBlack: "#5a5a78",
    brightRed: "#ff5a8a",
    brightGreen: "#caff6a",
    brightYellow: "#ffe06a",
    brightBlue: "#6ac2ff",
    brightMagenta: "#ff7ae4",
    brightCyan: "#6af0ff",
    brightWhite: "#ffffff",
  };

  let container: HTMLDivElement;
  let term: Terminal | null = null;
  let fitAddon: FitAddon | null = null;
  let fontSize = DEFAULT_FONT_SIZE;
  let pendingOutput: string[] = [];
  let pendingOutputBytes = 0;
  let resizeFrame: number | null = null;

  let searchQuery = $state("");
  let searchInput = $state<HTMLInputElement | null>(null);
  let bellFlash = $state(false);

  // ghostty ships no search addon, so we roll our own on buffer.active. matches are
  // absolute buffer rows; they go stale if output streams mid-search, which is fine -
  // search is a momentary action and the next keystroke re-scans.
  let matches: { row: number; col: number }[] = [];
  let matchIdx = -1;
  let queryLen = 0;
  let matchInfo = $state<{ current: number; total: number } | null>(null);

  // each panel gets its OWN wasm instance, not the shared init() singleton. sharing
  // one instance across terminals bleeds a dead shell's freed cell memory into the
  // next terminal's screen buffer - close a nushell/powershell tab, open ssh, and the
  // old session ghosts through because ghostty_terminal_new doesn't zero what the
  // allocator handed back. isolation = no shared memory = no ghost. (cmd was too
  // trivial to leave visible residue, which is exactly how we caught it.)
  onMount(() => {
    let disposed = false;
    const cleanups: Array<() => void> = [];

    Ghostty.load().then((ghostty) => {
      if (disposed || !container) return;

      term = new Terminal({
        ghostty,
        theme: TERMINAL_THEME,
        allowTransparency: true,
        fontFamily: '"Geist Mono", "JetBrainsMono Nerd Font", "CaskaydiaCove Nerd Font", "FiraCode Nerd Font", "JetBrains Mono", "IBM Plex Mono", "Fira Code", "Cascadia Code", monospace',
        fontSize: DEFAULT_FONT_SIZE,
        cursorBlink: true,
        cursorStyle: "bar",
        scrollback: 10000,
      });

      const addon = new FitAddon();
      term.loadAddon(addon);
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

      fitAddon = addon;

      // heads up: ghostty inverts xterm's contract. here true = "swallow this key"
      // (it does preventDefault + bails), false = "let ghostty send it to the pty".
      // so we return true for keys we handle ourselves, false for normal typing.
      // preventDefault doesn't stop propagation, so the global-shortcut keys still
      // bubble to the window listener in shortcuts.ts.
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
            fontSize = Math.min(MAX_FONT_SIZE, fontSize + 1);
            term!.options.fontSize = fontSize;
            addon.fit();
            return true;
          }
          if (ev.code === "Minus") {
            fontSize = Math.max(MIN_FONT_SIZE, fontSize - 1);
            term!.options.fontSize = fontSize;
            addon.fit();
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
        bellFlash = true;
        setTimeout(() => (bellFlash = false), 200);
      });

      const onSelectionDisposable = term.onSelectionChange(() => {
        const sel = term!.getSelection();
        if (sel) navigator.clipboard.writeText(sel).catch(() => {});
      });

      addon.fit();

      let unlistenOutput: (() => void) | null = null;
      let unlistenClosed: (() => void) | null = null;

      onTerminalOutput(channelId, (data) => {
        if (active) {
          term!.write(data);
        } else {
          pendingOutput.push(data);
          pendingOutputBytes += data.length;
          if (pendingOutputBytes >= MAX_INACTIVE_BUFFER_BYTES) {
            const pending = pendingOutput;
            pendingOutput = [];
            pendingOutputBytes = 0;
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
        if (!active || resizeFrame != null) return;
        resizeFrame = requestAnimationFrame(() => {
          resizeFrame = null;
          addon.fit();
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
      if (resizeFrame != null) cancelAnimationFrame(resizeFrame);
      cleanups.forEach((fn) => { try { fn(); } catch { /* tearing down, who cares */ } });
      try { term?.dispose(); } catch { /* ditto */ }
      // ghostty flips isDisposed early but detaches the canvas last, so if its
      // teardown throws partway the canvas stays parented and a retry no-ops it -
      // an orphaned ghost terminal bleeding through the next tab. we own the
      // container, so just empty it and stop trusting dispose to finish the job.
      container.replaceChildren();
    };
  });

  $effect(() => {
    if (!active) return;

    const frame = requestAnimationFrame(() => {
      fitAddon?.fit();
      if (pendingOutput.length > 0) {
        const pending = pendingOutput;
        pendingOutput = [];
        pendingOutputBytes = 0;
        term?.write(pending.join(""));
      }
      term?.focus();
    });

    return () => cancelAnimationFrame(frame);
  });

  $effect(() => {
    if (searchVisible && searchInput) {
      searchInput.focus();
    }
    if (!searchVisible) {
      searchQuery = "";
      matchInfo = null;
      matches = [];
      matchIdx = -1;
      term?.clearSelection();
    }
  });

  function highlightMatch(i: number) {
    const m = matches[i];
    if (!term || !m) return;
    term.clearSelection();
    term.select(m.col, m.row, queryLen);
    // drop the match near the middle of the viewport instead of pinning it to the top
    term.scrollToLine(Math.max(0, m.row - Math.floor(term.rows / 2)));
  }

  function navigate(delta: number) {
    if (matches.length === 0) return;
    let i = matchIdx + delta;
    if (i < 0) i = matches.length - 1;
    if (i >= matches.length) i = 0;
    matchIdx = i;
    highlightMatch(i);
    matchInfo = { current: i + 1, total: matches.length };
  }

  function runSearch(query: string) {
    searchQuery = query;
    if (!term) return;

    queryLen = query.length;
    if (!query) {
      matches = [];
      matchIdx = -1;
      term.clearSelection();
      matchInfo = null;
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
    matches = found;

    if (found.length === 0) {
      matchIdx = -1;
      term.clearSelection();
      matchInfo = { current: 0, total: 0 };
      return;
    }

    // land on the first hit at or below where we're already looking
    const viewTop = Math.floor(term.getViewportY());
    let start = found.findIndex((m) => m.row >= viewTop);
    if (start === -1) start = 0;
    matchIdx = start;
    highlightMatch(start);
    matchInfo = { current: start + 1, total: found.length };
  }

  function closeSearch() {
    onSearchToggle();
    term?.focus();
  }
</script>

<div class="terminal-wrapper {active ? 'terminal-active' : 'terminal-hidden'} {bellFlash ? 'terminal-bell' : ''}">
  {#if searchVisible}
    <!-- ghostty has a click-outside-to-deselect handler on document. our nav
         buttons set a selection then the click bubbles up and ghostty wipes it.
         stop the bubble here so anything in the search bar leaves the highlight alone. -->
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="terminal-search-bar" onclick={(e) => e.stopPropagation()}>
      <span class="terminal-search-label">find</span>
      <input
        bind:this={searchInput}
        class="terminal-search-input"
        placeholder="search..."
        value={searchQuery}
        oninput={(e) => runSearch(e.currentTarget.value)}
        onkeydown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            navigate(e.shiftKey ? -1 : 1);
          }
          if (e.key === "Escape") closeSearch();
        }}
      />
      {#if matchInfo}
        <span class="terminal-search-count {matchInfo.total === 0 ? 'no-match' : ''}">
          {matchInfo.total === 0 ? "no results" : `${matchInfo.current}/${matchInfo.total}`}
        </span>
      {/if}
      <!-- keep focus in the input on click so you can click an arrow then keep
           hitting Enter without re-focusing -->
      <button class="terminal-search-btn" onmousedown={(e) => e.preventDefault()} onclick={() => navigate(-1)} title="Previous match">
        &#x25B2;
      </button>
      <button class="terminal-search-btn" onmousedown={(e) => e.preventDefault()} onclick={() => navigate(1)} title="Next match">
        &#x25BC;
      </button>
      <button class="terminal-search-btn" onclick={closeSearch} title="Close search">
        &#x2715;
      </button>
    </div>
  {/if}

  <div class="terminal-inner" bind:this={container}></div>
</div>

<style>
  .terminal-wrapper {
    width: 100%;
    height: 100%;
    position: relative;
    overflow: hidden;
  }

  .terminal-active {
    visibility: visible;
    opacity: 1;
    pointer-events: auto;
    position: relative;
    z-index: 1;
  }

  .terminal-inner {
    width: 100%;
    height: 100%;
    overflow: hidden;
    padding: 8px 12px;
    position: relative;
    /* the frost tint lives HERE, not on the canvas. the canvas is fully transparent
       (theme bg = rgba 0) so the padding ring and the text area share one single tint
       layer - otherwise the padding gap shows lighter glass and reads as a fake border. */
    background: rgba(6, 6, 14, 0.62);
  }

  /* crt vignette glow - lost in the xterm->ghostty swap, back now and neon.
     sits over the canvas edges, pulls focus to the middle. */
  .terminal-inner::after {
    content: "";
    position: absolute;
    inset: 0;
    pointer-events: none;
    z-index: 9;
    box-shadow:
      inset 0 0 60px rgba(0, 0, 0, 0.55),
      inset 0 0 18px rgba(0, 212, 255, 0.06);
  }

  .terminal-hidden {
    visibility: hidden;
    opacity: 0;
    pointer-events: none;
    position: absolute;
    inset: 0;
  }

  /* top edge glow */
  .terminal-wrapper::before {
    content: "";
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 1px;
    background: linear-gradient(
      90deg,
      transparent,
      var(--border-glow) 30%,
      rgba(0, 212, 255, 0.12) 50%,
      var(--border-glow) 70%,
      transparent
    );
    z-index: 10;
    pointer-events: none;
  }

  /* scanlines */
  .terminal-wrapper::after {
    content: "";
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    pointer-events: none;
    background: repeating-linear-gradient(
      0deg,
      transparent,
      transparent 2px,
      rgba(0, 0, 0, 0.02) 2px,
      rgba(0, 0, 0, 0.02) 4px
    );
    z-index: 10;
  }

  /* search bar */

  .terminal-search-bar {
    position: absolute;
    top: 0;
    right: 0;
    z-index: 20;
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px 8px;
    background: var(--bg-secondary);
    border-bottom: 1px solid var(--border-glow);
    border-left: 1px solid var(--border-subtle);
    animation: search-slide-in 0.12s ease-out;
  }

  .terminal-search-label {
    font-size: 0.6rem;
    font-weight: 600;
    letter-spacing: 0.15em;
    text-transform: uppercase;
    color: var(--text-label);
    margin-right: 4px;
  }

  .terminal-search-input {
    background: var(--bg-primary);
    border: 1px solid var(--border-subtle);
    color: var(--text-primary);
    font-family: inherit;
    font-size: 0.8rem;
    padding: 3px 8px;
    width: 200px;
    outline: none;
    transition: border-color var(--transition-fast);
  }

  .terminal-search-input:focus {
    border-color: var(--accent-primary);
    box-shadow: 0 0 10px rgba(0, 212, 255, 0.3), inset 0 0 8px rgba(0, 212, 255, 0.05);
  }

  .terminal-search-input::placeholder {
    color: var(--text-dim);
  }

  .terminal-search-count {
    font-size: 0.7rem;
    color: var(--text-dim);
    min-width: 3.5ch;
    text-align: center;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .terminal-search-count.no-match {
    color: #e8254e;
  }

  .terminal-search-btn {
    background: none;
    border: 1px solid var(--border-subtle);
    color: var(--text-secondary);
    font-family: inherit;
    font-size: 0.7rem;
    padding: 3px 6px;
    cursor: pointer;
    line-height: 1;
    transition:
      border-color var(--transition-fast),
      color var(--transition-fast);
  }

  .terminal-search-btn:hover {
    border-color: var(--border-glow);
    color: var(--accent-primary);
  }

  @keyframes search-slide-in {
    from {
      opacity: 0;
      transform: translateY(-100%);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  /* visual bell */

  .terminal-bell .terminal-inner {
    animation: bell-flash 0.2s ease-out;
  }

  @keyframes bell-flash {
    0% {
      box-shadow: inset 0 0 40px rgba(0, 212, 255, 0.15);
    }
    100% {
      box-shadow: none;
    }
  }
</style>
