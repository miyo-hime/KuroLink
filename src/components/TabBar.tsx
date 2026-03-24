import type { TerminalTab } from "../lib/types";
import "./TabBar.css";

interface Props {
  tabs: TerminalTab[];
  activeTabId: string | null;
  onSelectTab: (channelId: string) => void;
  onCloseTab: (channelId: string) => void;
  onNewTab: () => void;
}

export default function TabBar({ tabs, activeTabId, onSelectTab, onCloseTab, onNewTab }: Props) {
  return (
    <div className="tab-bar">
      {tabs.map((tab) => (
        <div
          key={tab.channelId}
          className={`tab ${tab.channelId === activeTabId ? "tab-active" : ""}`}
          onClick={() => onSelectTab(tab.channelId)}
        >
          <span className="tab-title">{tab.title}</span>
          {tabs.length > 1 && (
            <button
              className="tab-close"
              onClick={(e) => {
                e.stopPropagation();
                onCloseTab(tab.channelId);
              }}
            >
              ×
            </button>
          )}
        </div>
      ))}
      <button className="tab-new" onClick={onNewTab} title="New terminal">
        +
      </button>
    </div>
  );
}
