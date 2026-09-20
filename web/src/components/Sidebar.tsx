import React from "react";
import {
  BookOpen,
  Boxes,
  CalendarClock,
  Database,
  KeyRound,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import type { KeyInfo } from "../types";

export type View = "workbench" | "groups" | "keys" | "review" | "recycle";

export interface ViewItem {
  id: View;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

export const VIEWS: ViewItem[] = [
  { id: "workbench", label: "记忆工作台", icon: BookOpen },
  { id: "groups", label: "分类管理", icon: Boxes },
  { id: "keys", label: "凭据管理", icon: KeyRound },
  { id: "review", label: "时效复核", icon: CalendarClock },
  { id: "recycle", label: "回收站", icon: Trash2 },
];

export function Sidebar({
  views = VIEWS,
  currentView,
  onSelectView,
  mobileOpen,
  onCloseMobile,
  info,
}: {
  views?: ViewItem[];
  currentView: View;
  onSelectView: (view: View) => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
  info: KeyInfo;
}) {
  return (
    <>
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm md:hidden"
          onClick={onCloseMobile}
          aria-hidden="true"
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-56 flex-col border-r border-stroke bg-acrylic backdrop-blur-md transition-transform duration-normal ease-fluent md:static md:translate-x-0 ${
          mobileOpen ? "translate-x-0 shadow-dialog" : "-translate-x-full md:translate-x-0"
        }`}
      >
        <div className="flex h-14 items-center justify-between border-b border-stroke px-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded bg-brand/10 text-brand">
              <Database className="h-4 w-4" aria-hidden />
            </div>
            <span className="text-sm font-semibold tracking-tight text-foreground select-none">
              Capsa Studio
            </span>
          </div>
          <button
            type="button"
            aria-label="关闭导航菜单"
            onClick={onCloseMobile}
            className="rounded p-1 text-muted hover:bg-surface hover:text-foreground md:hidden"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <nav aria-label="主视图" className="flex-1 space-y-1 overflow-y-auto px-2.5 py-3">
          {views.map((item) => {
            const Icon = item.icon;
            const active = currentView === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  onSelectView(item.id);
                  onCloseMobile();
                }}
                aria-current={active ? "page" : undefined}
                className={`relative flex w-full items-center gap-2.5 rounded px-3 py-2 text-[13px] font-medium transition-colors text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-brand ${
                  active
                    ? "bg-surface text-brand shadow-card"
                    : "text-foreground hover:bg-surface/60 hover:text-foreground"
                }`}
              >
                {active && (
                  <span className="absolute bottom-1.5 left-0 top-1.5 w-1 rounded-r bg-brand" />
                )}
                <Icon
                  className={`h-4 w-4 shrink-0 ${active ? "text-brand" : "text-muted"}`}
                  aria-hidden
                />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="flex items-center justify-between border-t border-stroke p-3 text-xs text-muted">
          <span className="truncate max-w-[120px]" title={info.name}>
            {info.name}
          </span>
          <span className="inline-flex items-center gap-1 rounded bg-brand/10 px-1.5 py-0.5 text-[11px] font-medium text-brand">
            <ShieldCheck className="h-3 w-3" aria-hidden />
            管理员
          </span>
        </div>
      </aside>
    </>
  );
}
