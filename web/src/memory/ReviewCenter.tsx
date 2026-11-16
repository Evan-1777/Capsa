import { CalendarClock } from "lucide-react";
import { useState } from "react";

import { api } from "../api";
import {
  Button,
  Card,
  EmptyState,
  ErrorBanner,
  Skeleton,
  UnauthorizedState,
} from "../components/ui";
import { useAsync } from "../useAsync";

const EXTENSIONS = [30, 90];

function extend(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString();
}

export function ReviewCenter({ workspaceId }: { workspaceId: string }) {
  const [version, setVersion] = useState(0);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const list = useAsync(
    (signal) => api.memories({ workspace_id: workspaceId, status: "overdue", limit: 100 }, signal),
    [workspaceId, version],
  );

  async function postpone(id: string, days: number) {
    setBusyId(id);
    setFailure(null);
    try {
      await api.update(id, { review_at: extend(days) });
      setVersion((current) => current + 1);
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "延期失败");
    } finally {
      setBusyId(null);
    }
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
      <div className="space-y-0.5">
        <h1 className="text-headline-small text-on-surface">时效复核</h1>
        <p className="text-body-medium text-on-surface-variant">
          {items.length} 条记忆已过复核时间
        </p>
      </div>

      {failure && (
        <p role="alert" className="text-body-small text-error">
          {failure}
        </p>
      )}

      <Card as="ul" role="list" variant="outlined" className="divide-y divide-outline-variant overflow-hidden">
        {items.map((item) => (
          <li key={item.id} className="flex items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-0 space-y-1">
              <p className="truncate text-title-small text-on-surface">{item.title}</p>
              <p className="flex items-center gap-1.5 text-body-small font-medium text-warning">
                <CalendarClock className="h-3.5 w-3.5 shrink-0" aria-hidden />
                <span>复核时间 {item.review_at?.slice(0, 10)}</span>
                <span className="font-normal text-on-surface-variant">· {item.group_slug}</span>
              </p>
            </div>
            <div className="flex shrink-0 gap-1.5">
              {EXTENSIONS.map((days) => (
                <Button
                  key={days}
                  variant="tonal"
                  size="sm"
                  type="button"
                  disabled={busyId === item.id}
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
