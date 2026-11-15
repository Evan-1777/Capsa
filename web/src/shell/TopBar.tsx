import { Database, LogOut, Menu, Moon, Settings2, ShieldCheck, Sun } from "lucide-react";

import { Button, IconButton, Select } from "../components/ui";
import type { KeyInfo } from "../types";
import type { WorkspaceShellProps } from "./AppShell";

export interface TopBarProps extends WorkspaceShellProps {
  info: KeyInfo;
  theme: "light" | "dark";
  onToggleTheme: () => void;
  onSignOut: () => void;
  currentTitle?: string;
  /** 仅在子应用已挂载导航时传入；缺省即不渲染窄屏菜单入口。 */
  onOpenMobileNav?: () => void;
}

export function TopBar({
  info,
  theme,
  onToggleTheme,
  onSignOut,
  currentTitle,
  onOpenMobileNav,
  workspaces,
  activeWorkspaceId,
  onSelectWorkspace,
  settingsActive,
  onOpenSettings,
}: TopBarProps) {
  const hasWorkspaces = Boolean(workspaces && workspaces.length > 0);

  return (
    <header className="flex h-16 shrink-0 items-center justify-between gap-3 border-b border-outline-variant bg-surface-container px-4 text-on-surface">
      <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
        {onOpenMobileNav && (
          <IconButton
            aria-label="打开导航菜单"
            onClick={onOpenMobileNav}
            className="md:hidden"
          >
            <Menu className="h-5 w-5" aria-hidden />
          </IconButton>
        )}
        <span className="hidden h-8 w-8 shrink-0 items-center justify-center rounded-sm bg-primary-container text-on-primary-container sm:flex">
          <Database className="h-4 w-4" aria-hidden />
        </span>
        <span className="hidden truncate text-title-medium text-on-surface sm:inline">
          Capsa Studio
        </span>
        {hasWorkspaces && (
          <Select
            aria-label="切换工作区"
            value={activeWorkspaceId ?? ""}
            onChange={(event) => onSelectWorkspace?.(event.target.value)}
            className="!w-auto max-w-[150px] shrink-0 sm:max-w-[220px]"
          >
            {(workspaces ?? []).map((workspace) => (
              <option key={workspace.id} value={workspace.id}>
                {workspace.name}（{workspace.mode === "docs" ? "文档" : "记忆"}）
              </option>
            ))}
          </Select>
        )}
        {currentTitle && (
          <span className="hidden min-w-0 items-center gap-2 lg:flex">
            <span className="text-title-medium text-on-surface-variant">/</span>
            <span className="truncate text-title-medium text-on-surface-variant">{currentTitle}</span>
          </span>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
        <span className="hidden items-center gap-1.5 rounded-full bg-surface-container-highest px-3 py-1 text-label-medium text-on-surface-variant sm:flex">
          <ShieldCheck className="h-3.5 w-3.5 text-primary" aria-hidden />
          <span className="max-w-[140px] truncate">{info.name}</span>
        </span>
        {onOpenSettings && (
          <IconButton
            aria-label="工作区设置"
            title="工作区设置"
            selected={settingsActive}
            onClick={onOpenSettings}
          >
            <Settings2 className="h-5 w-5" aria-hidden />
          </IconButton>
        )}
        <IconButton
          aria-label={theme === "dark" ? "切换至浅色模式" : "切换至深色模式"}
          onClick={onToggleTheme}
        >
          {theme === "dark" ? (
            <Sun className="h-5 w-5" aria-hidden />
          ) : (
            <Moon className="h-5 w-5" aria-hidden />
          )}
        </IconButton>
        <Button
          variant="text"
          size="sm"
          onClick={onSignOut}
          aria-label="退出"
          className="!px-2 sm:!px-4"
        >
          <LogOut className="h-3.5 w-3.5" aria-hidden />
          <span className="hidden sm:inline">退出</span>
        </Button>
      </div>
    </header>
  );
}
