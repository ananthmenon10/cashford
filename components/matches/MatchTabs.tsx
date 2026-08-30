"use client";

import {
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { MATCH_COPY } from "@/lib/match-copy";

type MatchTab = {
  id: string;
  label: string;
  content: ReactNode;
};

function selectedTabId(tabs: MatchTab[], initialTab: string): string {
  return tabs.some((tab) => tab.id === initialTab)
    ? initialTab
    : tabs[0]?.id ?? "";
}

export function MatchTabs({
  tabs,
  initialTab,
  children,
}: {
  tabs: Array<{ id: string; label: string; content: ReactNode }>;
  initialTab: string;
  children?: ReactNode;
}) {
  const id = useId().replace(/:/g, "");
  const [activeTab, setActiveTab] = useState(() => selectedTabId(tabs, initialTab));
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const selectTab = (tabId: string) => {
    setActiveTab(tabId);
    if (typeof window === "undefined") return;

    const params = new URLSearchParams(window.location.search);
    if (tabId === "overview") {
      params.delete("tab");
    } else {
      params.set("tab", tabId);
    }
    const query = params.toString();
    const nextUrl = `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`;
    window.history.replaceState(window.history.state, "", nextUrl);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight") {
      nextIndex = (index + 1) % tabs.length;
    } else if (event.key === "ArrowLeft") {
      nextIndex = (index - 1 + tabs.length) % tabs.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = tabs.length - 1;
    }
    if (nextIndex == null) return;

    event.preventDefault();
    const nextTab = tabs[nextIndex];
    selectTab(nextTab.id);
    tabRefs.current[nextIndex]?.focus();
  };

  if (!tabs.length) return children ? <div className="min-w-0 overflow-x-clip">{children}</div> : null;

  if (tabs.length <= 1) {
    const tab = tabs[0];
    return (
      <div className="min-w-0 overflow-x-clip">
        {children ? (
          <div className="sticky top-0 z-20 -mx-4 border-b border-border bg-surface">
            {children}
          </div>
        ) : null}
        <div
          id={`${id}-panel-${tab.id}`}
          role="tabpanel"
          aria-label={tab.label}
          className="min-w-0 space-y-4 pt-4"
        >
          {tab.content}
        </div>
      </div>
    );
  }

  return (
    <div className="min-w-0 overflow-x-clip">
      <div className="sticky top-0 z-20 -mx-4 border-b border-border bg-surface">
        {children}
        <div
          role="tablist"
          aria-label={MATCH_COPY.matchTabsAriaLabel}
          className="min-w-0 flex-nowrap gap-2 overflow-x-auto px-4 pb-2"
        >
          <div className="flex min-w-max flex-nowrap gap-2">
            {tabs.map((tab, index) => {
              const selected = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  ref={(element) => {
                    tabRefs.current[index] = element;
                  }}
                  type="button"
                  role="tab"
                  id={`${id}-tab-${tab.id}`}
                  aria-selected={selected}
                  aria-controls={`${id}-panel-${tab.id}`}
                  tabIndex={selected ? 0 : -1}
                  onClick={() => selectTab(tab.id)}
                  onKeyDown={(event) => onKeyDown(event, index)}
                  className={`shrink-0 rounded-pill px-3 py-1.5 font-mono text-[11px] font-bold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-press ${selected ? "bg-mint text-primary-press" : "bg-subtle text-muted"}`}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>
      <div className="min-w-0 space-y-4 pt-4">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            id={`${id}-panel-${tab.id}`}
            role="tabpanel"
            aria-labelledby={`${id}-tab-${tab.id}`}
            hidden={activeTab !== tab.id}
            className="min-w-0 space-y-4"
          >
            {tab.content}
          </div>
        ))}
      </div>
    </div>
  );
}
