import { CalendarClock } from "lucide-react";
import { useState } from "react";

import { api } from "../api";
import type { MemoryListItem } from "../types";
import { useAsync } from "../useAsync";
import { EmptyState, ErrorBanner, Skeleton, UnauthorizedState } from "./States";

const EXTENSIONS = [30, 90];

function extend(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString();
}

export function ReviewCenter() {
  const [version, setVersion] = useState(0);
  const list = useAsync(() => api.memories({ status: "overdue", limit: 100 }), [version]);

  async function postpone(id: string, days: number) {
    await api.update(id, { review_at: extend(days) });
    setVersion((current) => current + 1);
  }

  if (list.loading) return <Skeleton rows={4} />;
  if (list.error?.code === "UNAUTHORIZED") return <UnauthorizedState />;
  if (list.error) return <ErrorBanner message={list.error.message} onRetry={list.reload} />;

  const items = (list.data?.items ?? []).filter((item) => item.is_overdue);
  if (items.length === 0) {
    return <EmptyState message="所有追踪记忆均在有效期内" />;
  }

  return (
    <div className="mx-auto max-w-3xl space-y-2 px-5 py-6">
      <h1 className="text-sm font-semibold tracking-tight">时效复核</h1>
      <p className="text-xs text-zinc-500">{items.length} 条记忆已过复核时间</p>
      <ul className="divide-y divide-zinc-200 border-y border-zinc-200 bg-white">
        {items.map((item) => (
          <li key={item.id} className="flex items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-0 space-y-1">
              <p className="truncate text-[13px] font-medium">{item.title}</p>
              <p className="flex items-center gap-1.5 text-[11px] text-amber-700">
                <CalendarClock className="h-3 w-3" aria-hidden />
                复核时间 {item.review_at?.slice(0, 10)}
                <span className="text-zinc-400">· {item.group_slug}</span>
              </p>
            </div>
            <div className="flex shrink-0 gap-1.5">
              {item.permission === "rw" ? (
                EXTENSIONS.map((days) => (
                  <button
                    key={days}
                    type="button"
                    onClick={() => postpone(item.id, days)}
                    className="rounded border border-zinc-300 px-2.5 py-1 text-xs text-zinc-700 hover:bg-zinc-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                  >
                    延期 +{days} 天
                  </button>
                ))
              ) : (
                <span className="text-[11px] text-zinc-400">只读</span>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
