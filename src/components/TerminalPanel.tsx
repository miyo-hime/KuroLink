import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import "@xterm/xterm/css/xterm.css";
import { writeToShell, resizeShell, onTerminalOutput, onTerminalClosed } from "../lib/ipc";
import "./TerminalPanel.css";

interface Props {
  sessionId: string;
  channelId: string;
  active: boolean;
  onClosed?: () => void;
}

const TERMINAL_THEME = {
  background: "#080810",
  foreground: "#e0e0e8",
  cursor: "#00f0ff",
  cursorAccent: "#0a0a0f",
  selectionBackground: "rgba(0, 240, 255, 0.2)",
  black: "#0a0a0f",
  red: "#ff2d6b",
  green: "#b4ff39",
  yellow: "#f0c800",
  blue: "#00a0ff",
  magenta: "#c850c0",
  cyan: "#00f0ff",
  white: "#e0e0e8",
  brightBlack: "#5a5a72",
  brightRed: "#ff5a8a",
  brightGreen: "#c8ff60",
  brightYellow: "#ffe040",
  brightBlue: "#40b8ff",
  brightMagenta: "#e070e0",
  brightCyan: "#40f8ff",
  brightWhite: "#ffffff",
};

export default function TerminalPanel({ sessionId, channelId, active, onClosed }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const term = new Terminal({
      theme: TERMINAL_THEME,
      fontFamily: '"JetBrains Mono", "IBM Plex Mono", "Fira Code", "Cascadia Code", monospace',
      fontSize: 14,
      cursorBlink: true,
      cursorStyle: "bar",
      allowProposedApi: true,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);

    term.open(containerRef.current);

    // Try WebGL, fall back to canvas
    try {
      const webglAddon = new WebglAddon();
      webglAddon.onContextLoss(() => webglAddon.dispose());
      term.loadAddon(webglAddon);
    } catch {
      // Canvas renderer fallback
    }

    fitAddon.fit();
    termRef.current = term;
    fitRef.current = fitAddon;

    // User input → SSH
    const onDataDisposable = term.onData((data) => {
      writeToShell(sessionId, channelId, data).catch(() => {});
    });

    // Terminal resize → PTY resize
    const onResizeDisposable = term.onResize(({ cols, rows }) => {
      resizeShell(sessionId, channelId, cols, rows).catch(() => {});
    });

    // SSH output → terminal
    let unlistenOutput: (() => void) | null = null;
    let unlistenClosed: (() => void) | null = null;

    onTerminalOutput(channelId, (data) => {
      term.write(data);
    }).then((fn) => { unlistenOutput = fn; });

    onTerminalClosed(channelId, () => {
      onClosed?.();
    }).then((fn) => { unlistenClosed = fn; });

    // Resize observer
    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit();
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      onDataDisposable.dispose();
      onResizeDisposable.dispose();
      unlistenOutput?.();
      unlistenClosed?.();
      term.dispose();
    };
  }, [sessionId, channelId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Re-fit and focus when tab becomes active
  useEffect(() => {
    if (active && fitRef.current && termRef.current) {
      fitRef.current.fit();
      termRef.current.focus();
    }
  }, [active]);

  return (
    <div
      className={`terminal-container ${active ? "" : "terminal-hidden"}`}
      ref={containerRef}
    />
  );
}
