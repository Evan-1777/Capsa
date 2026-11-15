import React, { useCallback, useState } from "react";

import type { KeyInfo } from "../types";
import { Navigation, type NavItem } from "./Navigation";
import { TopBar } from "./TopBar";

export interface AppShellProps {
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
        />
        <main className="flex min-h-0 flex-1 flex-col overflow-hidden">{children}</main>
      </div>
    </div>
  );
}
