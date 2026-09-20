import { CalendarClock } from "lucide-react";
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
    <div className="mx-auto max-w-3xl space-y-3 px-5 py-6">
      <div className="space-y-1">
        <h1 className="text-sm font-semibold tracking-tight text-foreground">时效复核</h1>
        <p className="text-xs text-muted">{items.length} 条记忆已过复核时间</p>
      </div>

      <Card as="ul" role="list" className="divide-y divide-stroke overflow-hidden">
        {items.map((item) => (
          <li key={item.id} className="flex items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-0 space-y-1">
              <p className="truncate text-body font-medium text-foreground">{item.title}</p>
              <p className="flex items-center gap-1.5 text-caption text-warning font-medium">
                <CalendarClock className="h-3 w-3 shrink-0" aria-hidden />
                <span>复核时间 {item.review_at?.slice(0, 10)}</span>
                <span className="text-muted font-normal">· {item.group_slug}</span>
              </p>
            </div>
            <div className="flex shrink-0 gap-1.5">
              {EXTENSIONS.map((days) => (
                <Button
                  key={days}
                  variant="secondary"
                  size="sm"
                  type="button"
                  onClick={() => postpone(item.id, days)}
                >
                  延期 +{days} 天
                </Button>
              ))}
            </div>
          </li>
        ))}
      </Card>
    </div>
  );
}