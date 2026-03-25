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
  onTitleChange?: (title: string) => void;
}

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

export default function TerminalPanel({ sessionId, channelId, active, onClosed, onTitleChange }: Props) {
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

    // keystrokes -> ssh
    const onDataDisposable = term.onData((data) => {
      writeToShell(sessionId, channelId, data).catch(() => {});
    });

    // resize -> pty resize (must be registered BEFORE first fit()
    // so the initial size actually reaches the PTY)
    const onResizeDisposable = term.onResize(({ cols, rows }) => {
      resizeShell(sessionId, channelId, cols, rows).catch(() => {});
    });

    // osc title changes -> tab title
    const onTitleDisposable = term.onTitleChange((title) => {
      onTitleChange?.(title);
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

    return () => {
      resizeObserver.disconnect();
      onDataDisposable.dispose();
      onResizeDisposable.dispose();
      onTitleDisposable.dispose();
      unlistenOutput?.();
      unlistenClosed?.();
      term.dispose();
    };
  }, [sessionId, channelId]); // eslint-disable-line react-hooks/exhaustive-deps

  // re-fit on tab switch
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
