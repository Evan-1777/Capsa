import { useCallback, useEffect, useState } from "react";
import { BookOpen, Boxes, CalendarClock, KeyRound, Trash2 } from "lucide-react";

import { ApiError, api } from "../api";
import { ErrorBanner, Skeleton } from "../components/ui";
import { AppShell, type NavItem } from "../shell";
import type { GroupInfo, KeyInfo } from "../types";
import { GroupManager } from "./GroupManager";
import { KeyManager } from "./KeyManager";
import { MemoryWorkspace } from "./MemoryWorkspace";
import { RecycleBin } from "./RecycleBin";
import { ReviewCenter } from "./ReviewCenter";

export type MemoryView = "workbench" | "groups" | "keys" | "review" | "recycle";

export const MEMORY_NAV_ITEMS: NavItem<MemoryView>[] = [
  { id: "workbench", label: "记忆工作台", icon: BookOpen },
  { id: "groups", label: "分类管理", icon: Boxes },
  { id: "keys", label: "凭据管理", icon: KeyRound },
  { id: "review", label: "时效复核", icon: CalendarClock },
  { id: "recycle", label: "回收站", icon: Trash2 },
];

/** 传统记忆业务子应用：自治声明导航与分组数据流，单向装配全局外壳。 */
export function MemoryApp({
  info,
  theme,
  onToggleTheme,
  onSignOut,
}: {
  info: KeyInfo;
  theme: "light" | "dark";
  onToggleTheme: () => void;
  onSignOut: () => void;
}) {
  const [groups, setGroups] = useState<GroupInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [groupsError, setGroupsError] = useState<string | null>(null);
  const [view, setView] = useState<MemoryView>("workbench");

  const refreshGroups = useCallback(async () => {
    const listed = await api.groups();
    setGroups(listed.items);
    setGroupsError(null);
  }, []);

  const loadGroups = useCallback(async () => {
    setLoading(true);
    try {
      await refreshGroups();
    } catch (error) {
      // 401 由全局守卫接管并卸载本组件，不在此处重复呈现。
      if (!(error instanceof ApiError && error.code === "UNAUTHORIZED")) {
        setGroupsError(error instanceof Error ? error.message : "分类列表加载失败");
      }
    } finally {
      setLoading(false);
    }
  }, [refreshGroups]);

  useEffect(() => {
    void loadGroups();
  }, [loadGroups]);

  const ready = !loading && groupsError === null;
  const currentTitle = MEMORY_NAV_ITEMS.find((item) => item.id === view)?.label ?? "记忆工作台";

  return (
    <AppShell
      info={info}
      theme={theme}
      onToggleTheme={onToggleTheme}
      onSignOut={onSignOut}
      currentTitle={ready ? currentTitle : "记忆工作台"}
      navItems={ready ? MEMORY_NAV_ITEMS : undefined}
      activeNavId={view}
      onSelectNav={(id) => setView(id as MemoryView)}
    >
      {loading ? (
        <Skeleton rows={3} />
      ) : groupsError ? (
        <ErrorBanner message={groupsError} onRetry={loadGroups} />
      ) : view === "workbench" ? (
        <MemoryWorkspace groups={groups} onManageGroups={() => setView("groups")} />
      ) : view === "groups" ? (
        <GroupManager groups={groups} onGroupsChange={refreshGroups} />
      ) : view === "keys" ? (
        <KeyManager groups={groups} currentKeyId={info.key_id} />
      ) : view === "review" ? (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <ReviewCenter />
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <RecycleBin />
        </div>
      )}
    </AppShell>
  );
}
