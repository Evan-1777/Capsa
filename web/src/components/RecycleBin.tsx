import { useState } from "react";

import { api } from "../api";
import { useAsync } from "../useAsync";
import {
  Button,
  Card,
  EmptyState,
  ErrorBanner,
  Skeleton,
  UnauthorizedState,
} from "./ui";

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
    <div className="mx-auto max-w-3xl space-y-3 px-5 py-6">
      <div className="space-y-1">
        <h1 className="text-sm font-semibold tracking-tight text-foreground">回收站</h1>
        {failure && (
          <p role="alert" className="text-xs text-danger">
            {failure}
          </p>
        )}
      </div>

      <Card as="ul" role="list" className="divide-y divide-stroke overflow-hidden">
        {items.map((item) => (
          <li key={item.id} className="flex items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-0 space-y-1">
              <p className="truncate text-body font-medium text-foreground">{item.title}</p>
              <p className="truncate text-caption text-muted">
                {item.group_slug} · 删除于 {item.deleted_at?.slice(0, 10)} · {item.deleted_reason}
              </p>
            </div>
            <Button
              variant="secondary"
              size="sm"
              type="button"
              onClick={() => restore(item.id)}
              className="shrink-0"
            >
              恢复
            </Button>
          </li>
        ))}
      </Card>
    </div>
  );
}