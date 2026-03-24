import "./App.css";

function App() {
  return (
    <div className="app">
      <div className="boot-screen">
        <div className="logo">
          <pre className="logo-ascii">{`
╔═══════════════════════════╗
║       K U R O L I N K     ║
╚═══════════════════════════╝`}</pre>
          <span className="version">v0.1.0 · kurobox</span>
        </div>
        <div className="status-line">
          <span className="blink">▸</span> initializing...
        </div>
      </div>
    </div>
  );
}

export default App;
