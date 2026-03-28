import { useState, useRef, useEffect, useCallback } from "react";
import type { TerminalTab, ConnectionProfile } from "../lib/types";
import "./TabBar.css";

interface Props {
  tabs: TerminalTab[];
  activeTabId: string | null;
  profiles: ConnectionProfile[];
  onSelectTab: (channelId: string) => void;
  onCloseTab: (channelId: string) => void;
  onNewTab: () => void;
  onNewSshTab: (profileId: string) => void;
  onNewLocalTab: (shellType: "powershell" | "cmd" | "wsl") => void;
  onReorderTabs: (fromIndex: number, toIndex: number) => void;
}

// context menu
interface ContextMenu {
  x: number;
  y: number;
  channelId: string;
}

export default function TabBar({
  tabs,
  activeTabId,
  profiles,
  onSelectTab,
  onCloseTab,
  onNewTab,
  onNewSshTab,
  onNewLocalTab,
  onReorderTabs,
}: Props) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number } | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const arrowRef = useRef<HTMLButtonElement>(null);
  const contextRef = useRef<HTMLDivElement>(null);

  // close dropdown/context menu on click-outside
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
      if (contextRef.current && !contextRef.current.contains(e.target as Node)) {
        setContextMenu(null);
      }
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setDropdownOpen(false);
        setContextMenu(null);
      }
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleEsc);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleEsc);
    };
  }, []);

  // -- drag reorder --
  const handleDragStart = useCallback((e: React.DragEvent, index: number) => {
    setDragIndex(index);
    e.dataTransfer.effectAllowed = "move";
    // firefox needs this
    e.dataTransfer.setData("text/plain", String(index));
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDropIndex(index);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent, toIndex: number) => {
      e.preventDefault();
      if (dragIndex !== null && dragIndex !== toIndex) {
        onReorderTabs(dragIndex, toIndex);
      }
      setDragIndex(null);
      setDropIndex(null);
    },
    [dragIndex, onReorderTabs],
  );

  const handleDragEnd = useCallback(() => {
    setDragIndex(null);
    setDropIndex(null);
  }, []);

  // -- context menu --
  const handleContextMenu = useCallback((e: React.MouseEvent, channelId: string) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, channelId });
  }, []);

  // middle-click to close
  const handleMouseDown = useCallback(
    (e: React.MouseEvent, channelId: string) => {
      if (e.button === 1) {
        e.preventDefault();
        onCloseTab(channelId);
      }
    },
    [onCloseTab],
  );

  // context menu actions
  const contextCloseOthers = useCallback(() => {
    if (!contextMenu) return;
    tabs.forEach((t) => {
      if (t.channelId !== contextMenu.channelId) onCloseTab(t.channelId);
    });
    setContextMenu(null);
  }, [contextMenu, tabs, onCloseTab]);

  const contextCloseToRight = useCallback(() => {
    if (!contextMenu) return;
    const idx = tabs.findIndex((t) => t.channelId === contextMenu.channelId);
    if (idx === -1) return;
    tabs.slice(idx + 1).forEach((t) => onCloseTab(t.channelId));
    setContextMenu(null);
  }, [contextMenu, tabs, onCloseTab]);

  // tab type indicator
  const tabIndicator = (tab: TerminalTab) => {
    if (tab.backend.kind === "ssh") {
      return <span className="tab-indicator tab-indicator-ssh" title={`SSH: ${tab.backend.profileName}`} />;
    }
    return <span className="tab-indicator tab-indicator-local" title={`Local: ${tab.backend.shellType}`} />;
  };

  return (
    <div className="tab-bar">
      <div className="tab-scroll">
      {tabs.map((tab, index) => (
        <div
          key={tab.channelId}
          className={[
            "tab",
            tab.channelId === activeTabId ? "tab-active" : "",
            dragIndex === index ? "tab-dragging" : "",
            dropIndex === index && dragIndex !== index ? "tab-drop-target" : "",
          ]
            .filter(Boolean)
            .join(" ")}
          onClick={() => onSelectTab(tab.channelId)}
          onMouseDown={(e) => handleMouseDown(e, tab.channelId)}
          onContextMenu={(e) => handleContextMenu(e, tab.channelId)}
          draggable
          onDragStart={(e) => handleDragStart(e, index)}
          onDragOver={(e) => handleDragOver(e, index)}
          onDrop={(e) => handleDrop(e, index)}
          onDragEnd={handleDragEnd}
        >
          {tabIndicator(tab)}
          <span className="tab-index">{index + 1}.</span>
          <span className="tab-title">{tab.title}</span>
          <button
            className="tab-close"
            onClick={(e) => {
              e.stopPropagation();
              onCloseTab(tab.channelId);
            }}
          >
            ×
          </button>
        </div>
      ))}
      </div>

      {/* new tab: split button */}
      <div className="tab-new-group">
        <button className="tab-new" onClick={onNewTab} title="New tab (same connection)">
          +
        </button>
        <div className="tab-dropdown-wrapper" ref={dropdownRef}>
          <button
            ref={arrowRef}
            className={`tab-dropdown-arrow ${dropdownOpen ? "tab-dropdown-open" : ""}`}
            onClick={() => {
              setDropdownOpen((v) => {
                if (!v && arrowRef.current) {
                  const rect = arrowRef.current.getBoundingClientRect();
                  const menuWidth = 220;
                  // anchor left to the button, but clamp so it doesn't overflow either edge
                  let left = rect.left;
                  if (left + menuWidth > window.innerWidth) {
                    left = window.innerWidth - menuWidth - 4;
                  }
                  if (left < 4) left = 4;
                  setDropdownPos({ top: rect.bottom, left });
                }
                return !v;
              });
            }}
            title="Open new connection"
          >
            ▾
          </button>
          {dropdownOpen && dropdownPos && (
            <div className="tab-dropdown" style={{ top: dropdownPos.top, left: dropdownPos.left }}>
              <div className="tab-dropdown-section">LOCAL</div>
              <button className="tab-dropdown-item" onClick={() => { onNewLocalTab("powershell"); setDropdownOpen(false); }}>
                PowerShell
              </button>
              <button className="tab-dropdown-item" onClick={() => { onNewLocalTab("cmd"); setDropdownOpen(false); }}>
                Command Prompt
              </button>
              <button className="tab-dropdown-item" onClick={() => { onNewLocalTab("wsl"); setDropdownOpen(false); }}>
                WSL
              </button>
              {profiles.length > 0 && (
                <>
                  <div className="tab-dropdown-divider" />
                  <div className="tab-dropdown-section">SSH PROFILES</div>
                  {profiles.map((p) => (
                    <button
                      key={p.id}
                      className="tab-dropdown-item"
                      onClick={() => { onNewSshTab(p.id); setDropdownOpen(false); }}
                    >
                      <span className="tab-dropdown-profile-name">{p.name}</span>
                      <span className="tab-dropdown-profile-host">{p.host}</span>
                    </button>
                  ))}
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* context menu */}
      {contextMenu && (
        <div
          ref={contextRef}
          className="tab-context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            className="tab-context-item"
            onClick={() => {
              onCloseTab(contextMenu.channelId);
              setContextMenu(null);
            }}
          >
            Close
          </button>
          {tabs.length > 1 && (
            <button className="tab-context-item" onClick={contextCloseOthers}>
              Close Others
            </button>
          )}
          {tabs.findIndex((t) => t.channelId === contextMenu.channelId) < tabs.length - 1 && (
            <button className="tab-context-item" onClick={contextCloseToRight}>
              Close to Right
            </button>
          )}
        </div>
      )}
    </div>
  );
}
