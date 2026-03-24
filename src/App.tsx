import { useState, useRef, useCallback } from "react";
import type { ConnectionProfile } from "./lib/types";
import ConnectionScreen from "./components/ConnectionScreen";
import MainView from "./components/MainView";
import "./App.css";

type AppView = "connect" | "terminal";

function App() {
  const [view, setView] = useState<AppView>("connect");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [profile, setProfile] = useState<ConnectionProfile | null>(null);
  const [glitching, setGlitching] = useState(false);
  const glitchRef = useRef<HTMLDivElement>(null);

  const handleConnected = (
    sid: string,
    _pid: string,
    prof: ConnectionProfile,
  ) => {
    setSessionId(sid);
    setProfile(prof);
    setView("terminal");
  };

  const handleDisconnected = useCallback(() => {
    setGlitching(true);
    setTimeout(() => {
      setGlitching(false);
      setSessionId(null);
      setProfile(null);
      setView("connect");
    }, 400);
  }, []);

  const handleSessionReconnected = useCallback((newSessionId: string) => {
    setSessionId(newSessionId);
  }, []);

  return (
    <div className="app">
      {view === "connect" && (
        <ConnectionScreen onConnected={handleConnected} />
      )}
      {view === "terminal" && sessionId && profile && (
        <div ref={glitchRef} className={glitching ? "view-glitch-out" : ""} style={{ height: "100%", width: "100%" }}>
          <MainView
            sessionId={sessionId}
            profile={profile}
            onDisconnected={handleDisconnected}
            onSessionReconnected={handleSessionReconnected}
          />
        </div>
      )}
    </div>
  );
}

export default App;
