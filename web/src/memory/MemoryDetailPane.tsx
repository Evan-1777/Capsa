import { Pencil, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

import { api } from "../api";
import {
  Button,
  Card,
  EmptyState,
  ErrorBanner,
  FormField,
  Input,
  Skeleton,
  UnauthorizedState,
} from "../components/ui";
import { Markdown } from "../components/ui/Markdown";
import type { MemoryDetail } from "../types";
import type { AsyncState } from "../useAsync";

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
  if (!state.data) return <EmptyState message="从左侧选择一条记忆查看正文" />;

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
      <Button variant="text" size="sm" onClick={onBack} className="px-2 md:hidden">
        返回列表
      </Button>

      <header className="space-y-4 border-b border-outline-variant pb-5">
        <div className="flex items-start justify-between gap-3">
          <h1 className="text-headline-small text-on-surface">{memory.title}</h1>
          <div className="flex shrink-0 items-center gap-2">
            <Button variant="tonal" size="sm" onClick={() => onEdit(memory)}>
              <Pencil className="h-3.5 w-3.5" aria-hidden />
              <span>编辑</span>
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setConfirming(true)}>
              <Trash2 className="h-3.5 w-3.5" aria-hidden />
              <span>删除</span>
            </Button>
          </div>
        </div>

        <dl className="flex flex-wrap gap-x-4 gap-y-1.5 text-body-small text-on-surface-variant">
          <div className="flex gap-1.5">
            <dt>分组</dt>
            <dd className="font-medium text-on-surface">{memory.group_slug}</dd>
          </div>
          <div className="flex gap-1.5">
            <dt>更新</dt>
            <dd className="text-on-surface">{memory.updated_at.slice(0, 10)}</dd>
          </div>
          <div className="flex gap-1.5">
            <dt>复核</dt>
            <dd className={memory.is_overdue ? "font-medium text-warning" : "text-on-surface"}>
              {memory.review_at ? memory.review_at.slice(0, 10) : "未设置"}
              {memory.is_overdue && " · 已过期"}
            </dd>
          </div>
          {memory.tags.length > 0 && (
            <div className="flex gap-1.5">
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
