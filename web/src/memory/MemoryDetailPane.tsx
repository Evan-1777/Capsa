import { ArrowLeft, Pencil, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

import { api } from "../api";
import {
  Button,
  Card,
  EmptyState,
  ErrorBanner,
  FormField,
  IconButton,
  Input,
  Skeleton,
  UnauthorizedState,
} from "../components/ui";
import { Markdown } from "../components/ui/Markdown";
import type { MemoryDetail } from "../types";
import type { AsyncState } from "../useAsync";
import { TierBadge } from "./MemoryWorkspace";

function formatLocalTimestamp(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function MemoryDetailPane({
  state,
  onEdit,
  onDeleted,
  onBack,
}: {
  state: AsyncState<MemoryDetail | null>;
  onEdit: (memory: MemoryDetail) => void;
  onDeleted: () => void;
  onBack: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState("");
  const [failure, setFailure] = useState<string | null>(null);
  const currentId = state.data?.id ?? null;

  useEffect(() => {
    setConfirming(false);
    setReason("");
    setFailure(null);
  }, [currentId]);

  if (state.loading) return <Skeleton rows={6} />;
  if (state.error?.code === "UNAUTHORIZED") return <UnauthorizedState />;
  if (state.error) return <ErrorBanner message={state.error.message} onRetry={state.reload} />;
  if (!state.data) return <EmptyState message="未选择记忆" />;

  const memory = state.data;

  async function remove() {
    if (!reason.trim()) return;
    try {
      await api.remove(memory.id, reason.trim());
      setConfirming(false);
      setReason("");
      onDeleted();
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "删除失败");
    }
  }

  return (
    <article className="mx-auto max-w-3xl space-y-6 px-5 py-6">
      <Button variant="text" size="sm" onClick={onBack} className="!px-2 md:hidden">
        <ArrowLeft className="h-4 w-4" aria-hidden />
        <span>返回</span>
      </Button>

      <header className="space-y-4 border-b border-outline-variant pb-5">
        <div className="flex items-start justify-between gap-3">
          <h1 className="text-headline-small text-on-surface">{memory.title}</h1>
          <div className="flex shrink-0 items-center gap-1">
            <IconButton
              variant="tonal"
              aria-label="编辑记忆"
              title="编辑"
              onClick={() => onEdit(memory)}
              className="!h-9 !w-9"
            >
              <Pencil className="h-4 w-4" aria-hidden />
            </IconButton>
            <IconButton
              aria-label="删除记忆"
              title="删除"
              onClick={() => setConfirming(true)}
              className="!h-9 !w-9"
            >
              <Trash2 className="h-4 w-4" aria-hidden />
            </IconButton>
          </div>
        </div>

        <dl className="flex flex-wrap items-center gap-x-4 gap-y-2 text-body-small text-on-surface-variant">
          <div className="flex items-center gap-1.5">
            <dt>状态</dt>
            <dd className="flex items-center gap-1.5">
              <TierBadge item={memory} />
              {memory.tier === "temporary" && memory.expires_at && (
                <span className="text-on-surface">
                  到期 {formatLocalTimestamp(memory.expires_at)}
                </span>
              )}
            </dd>
          </div>
          <div className="flex items-center gap-1.5">
            <dt>组别</dt>
            <dd className="font-mono font-medium text-on-surface">{memory.group_slug}</dd>
          </div>
          <div className="flex items-center gap-1.5">
            <dt>更新</dt>
            <dd className="text-on-surface">{memory.updated_at.slice(0, 10)}</dd>
          </div>
          {memory.tags.length > 0 && (
            <div className="flex items-center gap-1.5">
              <dt>标签</dt>
              <dd className="text-on-surface">{memory.tags.join("、")}</dd>
            </div>
          )}
        </dl>

        <p className="text-body-large text-on-surface-variant">{memory.summary}</p>
      </header>

      <Markdown>{memory.body}</Markdown>

      {confirming && (
        <Card variant="filled" className="space-y-3 p-4">
          <FormField label="删除原因" id="delete-reason-input">
            <Input
              id="delete-reason-input"
              value={reason}
              aria-label="删除原因"
              onChange={(event) => setReason(event.target.value)}
              placeholder="例如：内容已合并到另一条记忆"
            />
          </FormField>
          {failure && (
            <p role="alert" className="text-body-small text-error">
              {failure}
            </p>
          )}
          <div className="flex gap-2">
            <Button variant="danger" size="sm" onClick={remove} disabled={!reason.trim()}>
              移入回收站
            </Button>
            <Button variant="text" size="sm" onClick={() => setConfirming(false)}>
              取消
            </Button>
          </div>
        </Card>
      )}
    </article>
  );
}
