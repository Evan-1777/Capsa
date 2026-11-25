import { useCallback, useEffect, useState } from "react";
import { BookOpen, Boxes, KeyRound, Trash2 } from "lucide-react";

import { ApiError, api } from "../api";
import { ErrorBanner, Skeleton } from "../components/ui";
import { AppShell, type NavItem, type WorkspaceShellProps } from "../shell";
import type { GroupInfo, KeyInfo, WorkspaceInfo } from "../types";
import { GroupManager } from "./GroupManager";
import { KeyManager } from "./KeyManager";
import { MemoryWorkspace } from "./MemoryWorkspace";
import { RecycleBin } from "./RecycleBin";

export type MemoryView = "workbench" | "groups" | "keys" | "recycle";

export const MEMORY_NAV_ITEMS: NavItem<MemoryView>[] = [
  { id: "workbench", label: "记忆工作台", icon: BookOpen },
  { id: "groups", label: "组别管理", icon: Boxes },
  { id: "keys", label: "凭据管理", icon: KeyRound },
  { id: "recycle", label: "回收站", icon: Trash2 },
];

/** 记忆业务子应用：自治声明 4 项导航与组别数据流，单向装配全局外壳。 */
export function MemoryApp({
  info,
  theme,
  onToggleTheme,
  onSignOut,
  workspace,
  workspaces,
  onUpdateCurrentKeyName,
  shell,
}: {
  info: KeyInfo;
  theme: "light" | "dark";
  onToggleTheme: () => void;
  onSignOut: () => void;
  workspace: WorkspaceInfo;
  workspaces: WorkspaceInfo[];
  onUpdateCurrentKeyName: (nextName: string) => void;
  shell: WorkspaceShellProps;
}) {
  const [groups, setGroups] = useState<GroupInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [groupsError, setGroupsError] = useState<string | null>(null);
  const [view, setView] = useState<MemoryView>("workbench");

  const refreshGroups = useCallback(async () => {
    const listed = await api.groups(workspace.id);
    setGroups(listed.items);
    setGroupsError(null);
  }, [workspace.id]);

  const loadGroups = useCallback(async () => {
    setLoading(true);
    setGroupsError(null);
    try {
      await refreshGroups();
    } catch (error) {
      if (!(error instanceof ApiError && error.code === "UNAUTHORIZED")) {
        setGroupsError(error instanceof Error ? error.message : "组别列表加载失败");
      }
    } finally {
      setLoading(false);
    }
  }, [refreshGroups]);

  useEffect(() => {
    setView("workbench");
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
      {...shell}
    >
      {loading ? (
        <Skeleton rows={3} />
      ) : groupsError ? (
        <ErrorBanner message={groupsError} onRetry={loadGroups} />
      ) : view === "workbench" ? (
        <MemoryWorkspace
          key={workspace.id}
          workspaceId={workspace.id}
          shallowMonths={workspace.shallow_months}
          groups={groups}
          onManageGroups={() => setView("groups")}
        />
      ) : view === "groups" ? (
        <GroupManager
          key={workspace.id}
          workspaceId={workspace.id}
          groups={groups}
          onGroupsChange={refreshGroups}
        />
      ) : view === "keys" ? (
        <KeyManager
          workspaces={workspaces}
          currentKeyId={info.key_id}
          onUpdateCurrentKeyName={onUpdateCurrentKeyName}
        />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <RecycleBin key={workspace.id} workspaceId={workspace.id} />
        </div>
      )}
    </AppShell>
  );
}
