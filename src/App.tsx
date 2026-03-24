import { useState } from "react";
import type { ConnectionProfile } from "./lib/types";
import ConnectionScreen from "./components/ConnectionScreen";
import MainView from "./components/MainView";
import "./App.css";

type AppView = "connect" | "terminal";

function App() {
  const [view, setView] = useState<AppView>("connect");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [profile, setProfile] = useState<ConnectionProfile | null>(null);

  const handleConnected = (
    sid: string,
    _pid: string,
    prof: ConnectionProfile,
  ) => {
    setSessionId(sid);
    setProfile(prof);
    setView("terminal");
  };

  const handleDisconnected = () => {
    setSessionId(null);
    setProfile(null);
    setView("connect");
  };

  return (
    <div className="app">
      {view === "connect" && (
        <ConnectionScreen onConnected={handleConnected} />
      )}
      {view === "terminal" && sessionId && profile && (
        <MainView
          sessionId={sessionId}
          profile={profile}
          onDisconnected={handleDisconnected}
        />
      )}
    </div>
  );
}

export default App;
