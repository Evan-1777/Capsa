import { useState } from "react";

import { api } from "../api";
import { useAsync } from "../useAsync";
import { EmptyState, ErrorBanner, Skeleton, UnauthorizedState } from "./States";

export function RecycleBin() {
  const [version, setVersion] = useState(0);
  const [failure, setFailure] = useState<string | null>(null);
  const list = useAsync(() => api.memories({ status: "deleted", limit: 100 }), [version]);

  async function restore(id: string) {
    setFailure(null);
    try {
      await api.restore(id);
      setVersion((current) => current + 1);
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "恢复失败");
    }
  }

  if (list.loading) return <Skeleton rows={4} />;
  if (list.error?.code === "UNAUTHORIZED") return <UnauthorizedState />;
  if (list.error) return <ErrorBanner message={list.error.message} onRetry={list.reload} />;

  const items = list.data?.items ?? [];
  if (items.length === 0) return <EmptyState message="回收站暂无条目" />;

  return (
    <div className="mx-auto max-w-3xl space-y-2 px-5 py-6">
      <h1 className="text-sm font-semibold tracking-tight">回收站</h1>
      {failure && (
        <p role="alert" className="text-xs text-red-600">
          {failure}
        </p>
      )}
      <ul className="divide-y divide-zinc-200 border-y border-zinc-200 bg-white">
        {items.map((item) => (
          <li key={item.id} className="flex items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-0 space-y-1">
              <p className="truncate text-[13px] font-medium">{item.title}</p>
              <p className="truncate text-[11px] text-zinc-500">
                {item.group_slug} · 删除于 {item.deleted_at?.slice(0, 10)} · {item.deleted_reason}
              </p>
            </div>
            {item.permission === "rw" ? (
              <button
                type="button"
                onClick={() => restore(item.id)}
                className="shrink-0 rounded border border-zinc-300 px-2.5 py-1 text-xs text-zinc-700 hover:bg-zinc-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
              >
                恢复
              </button>
            ) : (
              <span className="shrink-0 text-[11px] text-zinc-400">只读</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
