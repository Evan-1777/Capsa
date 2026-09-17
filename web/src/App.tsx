import { useEffect, useState } from "react";

import { ApiError, api, clearKey, getKey, setUnauthorizedHandler } from "./api";
import { GroupManager } from "./components/GroupManager";
import { Header } from "./components/Header";
import { Login } from "./components/Login";
import { MemoryWorkspace } from "./components/MemoryList";
import { RecycleBin } from "./components/RecycleBin";
import { ReviewCenter } from "./components/ReviewCenter";
import { Skeleton, UnauthorizedState } from "./components/States";
import type { GroupInfo, KeyInfo } from "./types";

type View = "workbench" | "groups" | "review" | "recycle";

const VIEWS: Array<{ id: View; label: string }> = [
  { id: "workbench", label: "记忆工作台" },
  { id: "groups", label: "分类管理" },
  { id: "review", label: "时效复核" },
  { id: "recycle", label: "回收站" },
];

export default function App() {
  const [info, setInfo] = useState<KeyInfo | null>(null);
  const [groups, setGroups] = useState<GroupInfo[]>([]);
  const [view, setView] = useState<View>("workbench");
  const [loading, setLoading] = useState(true);
  const [expired, setExpired] = useState(false);

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
      <main className="min-h-screen bg-zinc-100">
        <Skeleton rows={3} />
      </main>
    );
  }

  if (!info) {
    return expired ? (
      <main className="grid min-h-screen place-items-center bg-zinc-100 px-4">
        <UnauthorizedState />
      </main>
    ) : (
      <Login onConnected={connect} />
    );
  }

  return (
    <div className="flex h-screen flex-col">
      <Header info={info} onSignOut={signOut} />
      <nav aria-label="主视图" className="flex gap-1 border-b border-zinc-200 bg-white px-4">
        {VIEWS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setView(item.id)}
            aria-current={view === item.id}
            className={`border-b-2 px-3 py-2 text-[13px] focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${view === item.id ? "border-zinc-900 font-medium text-zinc-900" : "border-transparent text-zinc-500 hover:text-zinc-800"}`}
          >
            {item.label}
          </button>
        ))}
      </nav>
      <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {view === "workbench" && (
          <MemoryWorkspace groups={groups} onManageGroups={() => setView("groups")} />
        )}
        {view === "groups" && <GroupManager groups={groups} onGroupsChange={refreshGroups} />}
        {view === "review" && <div className="min-h-0 flex-1 overflow-y-auto"><ReviewCenter /></div>}
        {view === "recycle" && <div className="min-h-0 flex-1 overflow-y-auto"><RecycleBin /></div>}
      </main>
    </div>
  );
}
