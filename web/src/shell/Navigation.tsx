import React, { useEffect } from "react";
import { ShieldCheck, X } from "lucide-react";

import { Badge, IconButton, SideSheet } from "../components/ui";
import type { KeyInfo } from "../types";

export interface NavItem<T extends string = string> {
  id: T;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

export interface NavigationProps {
  items: NavItem[];
  activeId?: string;
  onSelect: (id: string) => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
  info: KeyInfo;
}

const DESKTOP_BREAKPOINT = "(min-width: 768px)";

export function Navigation({
  items,
  activeId,
  onSelect,
  mobileOpen,
  onCloseMobile,
  info,
}: NavigationProps) {
  // 已 showModal 的原生对话框不受响应式隐藏类约束，跨入桌面断点必须主动退出模态态。
  useEffect(() => {
    if (!mobileOpen) return;
    const media = window.matchMedia(DESKTOP_BREAKPOINT);
    if (media.matches) {
      onCloseMobile();
      return;
    }
    const handleChange = (event: MediaQueryListEvent) => {
      if (event.matches) onCloseMobile();
    };
    media.addEventListener("change", handleChange);
    return () => media.removeEventListener("change", handleChange);
  }, [mobileOpen, onCloseMobile]);

  return (
    <>
      <nav
        aria-label="主视图"
        className="hidden w-[88px] shrink-0 flex-col items-center gap-1 overflow-y-auto border-r border-outline-variant bg-surface-container px-2 py-3 md:flex"
      >
        {items.map((item) => {
          const Icon = item.icon;
          const active = item.id === activeId;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelect(item.id)}
              aria-current={active ? "page" : undefined}
              className="flex w-full flex-col items-center gap-1 rounded-full py-1 text-label-small text-on-surface-variant focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              <span
                className={`md-state-layer flex h-8 w-14 items-center justify-center rounded-full transition-colors ${
                  active ? "bg-secondary-container text-on-secondary-container" : "text-on-surface-variant"
                }`}
              >
                <Icon className="h-5 w-5" aria-hidden />
              </span>
              <span className="max-w-full truncate">{item.label}</span>
            </button>
          );
        })}
      </nav>

      <SideSheet open={mobileOpen} onClose={onCloseMobile} side="left" aria-label="导航菜单">
        <aside className="flex h-full w-72 max-w-[85vw] flex-col rounded-r-lg bg-surface-container-high text-on-surface">
          <div className="flex h-16 shrink-0 items-center justify-between border-b border-outline-variant px-4">
            <span className="text-title-medium text-on-surface">Capsa Studio</span>
            <IconButton aria-label="关闭导航菜单" onClick={onCloseMobile}>
              <X className="h-5 w-5" aria-hidden />
            </IconButton>
          </div>

          <nav
            aria-label="主视图"
            className="min-h-0 flex-1 space-y-1 overflow-y-auto px-2 py-3"
          >
            {items.map((item) => {
              const Icon = item.icon;
              const active = item.id === activeId;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    onSelect(item.id);
                    onCloseMobile();
                  }}
                  aria-current={active ? "page" : undefined}
                  className={`md-state-layer flex w-full items-center gap-3 rounded-full px-4 py-2.5 text-left text-label-large focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${
                    active
                      ? "bg-secondary-container text-on-secondary-container"
                      : "text-on-surface-variant"
                  }`}
                >
                  <Icon className="h-5 w-5 shrink-0" aria-hidden />
                  <span className="truncate">{item.label}</span>
                </button>
              );
            })}
          </nav>

          <div className="shrink-0 border-t border-outline-variant p-3">
            <Badge variant="primary" className="max-w-full" title={info.name}>
              <ShieldCheck className="h-3 w-3 shrink-0" aria-hidden />
              <span className="truncate">{info.name}</span>
            </Badge>
          </div>
        </aside>
      </SideSheet>
    </>
  );
}
