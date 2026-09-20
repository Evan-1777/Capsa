import { useEffect, useState } from "react";

import { ApiError, api, clearKey, getKey, setUnauthorizedHandler } from "./api";
import { GroupManager } from "./components/GroupManager";
import { KeyManager } from "./components/KeyManager";
import { Login } from "./components/Login";
import { MemoryWorkspace } from "./components/MemoryList";
import { RecycleBin } from "./components/RecycleBin";
import { ReviewCenter } from "./components/ReviewCenter";
import { Sidebar, VIEWS, type View } from "./components/Sidebar";
import { TopBar } from "./components/TopBar";
import { Skeleton, UnauthorizedState } from "./components/ui";
import type { GroupInfo, KeyInfo } from "./types";

export default function App() {
  const [info, setInfo] = useState<KeyInfo | null>(null);
  const [groups, setGroups] = useState<GroupInfo[]>([]);
  const [view, setView] = useState<View>("workbench");
  const [loading, setLoading] = useState(true);
  const [expired, setExpired] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  const [theme, setTheme] = useState<"light" | "dark">(() => {
    return (
      (localStorage.getItem("capsa_theme") as "light" | "dark") ||
      (typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light")
    );
  });

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("capsa_theme", theme);
  }, [theme]);

  const toggleTheme = () => setTheme((t) => (t === "dark" ? "light" : "dark"));

  useEffect(() => {
    setUnauthorizedHandler(() => {
      setInfo(null);
      setExpired(true);
    });
  }, []);

  useEffect(() => {
    const key = getKey();
    if (!key) {
      setLoading(false);
      return;
    }
    let active = true;
    (async () => {
      try {
        const me = await api.me();
        const listed = await api.groups();
        if (!active) return;
        setInfo(me);
        setGroups(listed.items);
      } catch (error) {
        if (active && error instanceof ApiError && error.code !== "UNAUTHORIZED") {
          clearKey();
        }
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  async function refreshGroups() {
    const listed = await api.groups();
    setGroups(listed.items);
  }

  async function connect(_key: string, me: KeyInfo) {
    await refreshGroups();
    setExpired(false);
    setInfo(me);
    setView("workbench");
  }

  function signOut() {
    clearKey();
    setInfo(null);
    setGroups([]);
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-background">
        <Skeleton rows={3} />
      </main>
    );
  }

  if (!info) {
    return expired ? (
      <main className="grid min-h-screen place-items-center bg-background px-4">
        <UnauthorizedState />
      </main>
    ) : (
      <Login onConnected={connect} />
    );
  }

  const currentViewItem = VIEWS.find((v) => v.id === view) ?? VIEWS[0];

  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground">
      <Sidebar
        currentView={view}
        onSelectView={setView}
        mobileOpen={mobileOpen}
        onCloseMobile={() => setMobileOpen(false)}
        info={info}
      />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <TopBar
          currentViewLabel={currentViewItem.label}
          onToggleMobile={() => setMobileOpen((open) => !open)}
          onSignOut={signOut}
          theme={theme}
          onToggleTheme={toggleTheme}
          info={info}
        />
        <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {view === "workbench" && (
            <MemoryWorkspace groups={groups} onManageGroups={() => setView("groups")} />
          )}
          {view === "groups" && <GroupManager groups={groups} onGroupsChange={refreshGroups} />}
          {view === "keys" && <KeyManager groups={groups} currentKeyId={info.key_id} />}
          {view === "review" && (
            <div className="min-h-0 flex-1 overflow-y-auto">
              <ReviewCenter />
            </div>
          )}
          {view === "recycle" && (
            <div className="min-h-0 flex-1 overflow-y-auto">
              <RecycleBin />
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
