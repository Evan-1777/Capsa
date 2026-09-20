import { LogOut, Menu, Moon, ShieldCheck, Sun } from "lucide-react";
import type { KeyInfo } from "../types";

export function TopBar({
  currentViewLabel,
  onToggleMobile,
  onSignOut,
  theme,
  onToggleTheme,
  info,
}: {
  currentViewLabel: string;
  onToggleMobile: () => void;
  onSignOut: () => void;
  theme: "light" | "dark";
  onToggleTheme: () => void;
  info: KeyInfo;
}) {
  return (
    <header className="flex h-14 items-center justify-between border-b border-stroke bg-acrylic backdrop-blur-md px-4 py-2.5">
      <div className="flex items-center gap-3">
        <button
          type="button"
          aria-label="打开导航菜单"
          onClick={onToggleMobile}
          className="rounded p-1.5 text-muted hover:bg-surface hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-brand md:hidden"
        >
          <Menu className="h-5 w-5" />
        </button>
        <span className="text-sm font-semibold tracking-tight text-foreground select-none">
          {currentViewLabel}
        </span>
      </div>

      <div className="flex items-center gap-2 sm:gap-3">
        <span className="hidden items-center gap-1 text-xs text-muted sm:flex">
          <ShieldCheck className="h-3.5 w-3.5 text-brand" aria-hidden />
          <span className="truncate max-w-[140px]">{info.name}</span>
        </span>
        <button
          type="button"
          aria-label={theme === "dark" ? "切换至浅色模式" : "切换至深色模式"}
          onClick={onToggleTheme}
          className="rounded p-1.5 text-muted hover:bg-surface hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        >
          {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </button>
        <button
          type="button"
          onClick={onSignOut}
          className="flex items-center gap-1.5 rounded border border-stroke bg-surface px-2.5 py-1 text-xs font-medium text-foreground hover:bg-background focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        >
          <LogOut className="h-3.5 w-3.5" aria-hidden />
          <span>退出</span>
        </button>
      </div>
    </header>
  );
}
