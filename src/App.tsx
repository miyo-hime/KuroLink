import { useState, useRef, useCallback } from "react";
import type { ConnectionProfile } from "./lib/types";
import ConnectionScreen from "./components/ConnectionScreen";
import MainView from "./components/MainView";
import "./App.css";

type AppView = "connect" | "terminal";

function App() {
  const [view, setView] = useState<AppView>("connect");
  const [initialSessionId, setInitialSessionId] = useState<string | null>(null);
  const [initialProfile, setInitialProfile] = useState<ConnectionProfile | null>(null);
  const [initialLocalShell, setInitialLocalShell] = useState<"powershell" | "cmd" | "wsl" | null>(null);
  const [glitching, setGlitching] = useState(false);
  const glitchRef = useRef<HTMLDivElement>(null);

  const handleConnected = (
    sid: string,
    _pid: string,
    prof: ConnectionProfile,
  ) => {
    setInitialSessionId(sid);
    setInitialProfile(prof);
    setInitialLocalShell(null);
    setView("terminal");
  };

  const handleLocalTerminal = useCallback((shellType: "powershell" | "cmd" | "wsl") => {
    setInitialSessionId(null);
    setInitialProfile(null);
    setInitialLocalShell(shellType);
    setView("terminal");
  }, []);

  const handleDisconnected = useCallback(() => {
    setGlitching(true);
    setTimeout(() => {
      setGlitching(false);
      setInitialSessionId(null);
      setInitialProfile(null);
      setInitialLocalShell(null);
      setView("connect");
    }, 400);
  }, []);

  return (
    <div className="app">
      {view === "connect" && (
        <ConnectionScreen onConnected={handleConnected} onLocalTerminal={handleLocalTerminal} />
      )}
      {view === "terminal" && (initialLocalShell || (initialSessionId && initialProfile)) && (
        <div ref={glitchRef} className={glitching ? "view-glitch-out" : ""} style={{ height: "100%", width: "100%" }}>
          <MainView
            initialSessionId={initialSessionId}
            initialProfile={initialProfile}
            initialLocalShell={initialLocalShell}
            onDisconnected={handleDisconnected}
          />
        </div>
      )}
    </div>
  );
}

export default App;
