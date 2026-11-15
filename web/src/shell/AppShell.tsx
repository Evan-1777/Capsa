import React, { useCallback, useState } from "react";

import type { KeyInfo, WorkspaceInfo } from "../types";
import { Navigation, type NavItem } from "./Navigation";
import { TopBar } from "./TopBar";

/** 工作区相关的单向受控属性：由根组件持有状态，外壳与子应用只读取与回调。 */
export interface WorkspaceShellProps {
  workspaces?: WorkspaceInfo[];
  activeWorkspaceId?: string;
  onSelectWorkspace?: (id: string) => void;
  settingsActive?: boolean;
  onOpenSettings?: () => void;
}

export interface AppShellProps extends WorkspaceShellProps {
  info: KeyInfo;
  theme: "light" | "dark";
  onToggleTheme: () => void;
  onSignOut: () => void;
  currentTitle?: string;
  navItems?: NavItem[];
  activeNavId?: string;
  onSelectNav?: (id: string) => void;
  children: React.ReactNode;
}

/**
 * 全局应用外壳：纯单向受控，仅维护窄屏抽屉开关。
 * 导航配置与激活标识全部由子应用传入，不存在反向同步 Context。
 */
export function AppShell({
  info,
  theme,
  onToggleTheme,
  onSignOut,
  currentTitle,
  navItems,
  activeNavId,
  onSelectNav,
  workspaces,
  activeWorkspaceId,
  onSelectWorkspace,
  settingsActive,
  onOpenSettings,
  children,
}: AppShellProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const closeMobile = useCallback(() => setMobileOpen(false), []);
  const openMobile = useCallback(() => setMobileOpen(true), []);
  const hasNav = Boolean(navItems && navItems.length > 0);

  return (
    <div className="flex h-screen overflow-hidden bg-surface text-on-surface">
      {hasNav && (
        <Navigation
          items={navItems as NavItem[]}
          activeId={activeNavId}
          onSelect={onSelectNav ?? (() => undefined)}
          mobileOpen={mobileOpen}
          onCloseMobile={closeMobile}
          info={info}
        />
      )}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <TopBar
          info={info}
          theme={theme}
          onToggleTheme={onToggleTheme}
          onSignOut={onSignOut}
          currentTitle={currentTitle}
          onOpenMobileNav={hasNav ? openMobile : undefined}
          workspaces={workspaces}
          activeWorkspaceId={activeWorkspaceId}
          onSelectWorkspace={onSelectWorkspace}
          settingsActive={settingsActive}
          onOpenSettings={onOpenSettings}
        />
        <main className="flex min-h-0 flex-1 flex-col overflow-hidden">{children}</main>
      </div>
    </div>
  );
}
