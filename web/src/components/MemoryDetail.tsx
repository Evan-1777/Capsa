import { Pencil, Trash2 } from "lucide-react";
import { useState } from "react";

import { api } from "../api";
import type { MemoryDetail } from "../types";
import type { AsyncState } from "../useAsync";
import { Markdown } from "./Markdown";
import { Button, FormField, Input, Skeleton, EmptyState, ErrorBanner, UnauthorizedState } from "./ui";

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
    <article className="mx-auto max-w-3xl space-y-5 px-5 py-6">
      <Button
        variant="secondary"
        size="sm"
        onClick={onBack}
        className="mb-1 md:hidden"
      >
        返回列表
      </Button>

      <header className="space-y-3 border-b border-stroke pb-5">
        <div className="flex items-start justify-between gap-3">
          <h1 className="text-lg font-semibold leading-7 tracking-tight text-foreground">
            {memory.title}
          </h1>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => onEdit(memory)}
              className="gap-1.5"
            >
              <Pencil className="h-3.5 w-3.5" aria-hidden />
              <span>编辑</span>
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setConfirming(true)}
              className="gap-1.5"
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden />
              <span>删除</span>
            </Button>
          </div>
        </div>

        <dl className="flex flex-wrap gap-x-4 gap-y-1.5 text-caption text-muted">
          <div className="flex gap-1.5">
            <dt>分组</dt>
            <dd className="text-foreground font-medium">{memory.group_slug}</dd>
          </div>
          <div className="flex gap-1.5">
            <dt>更新</dt>
            <dd className="text-foreground">{memory.updated_at.slice(0, 10)}</dd>
          </div>
          <div className="flex gap-1.5">
            <dt>复核</dt>
            <dd className={memory.is_overdue ? "text-warning font-medium" : "text-foreground"}>
              {memory.review_at ? memory.review_at.slice(0, 10) : "未设置"}
              {memory.is_overdue && " · 已过期"}
            </dd>
          </div>
          {memory.tags.length > 0 && (
            <div className="flex gap-1.5">
              <dt>标签</dt>
              <dd className="text-foreground">{memory.tags.join("、")}</dd>
            </div>
          )}
        </dl>

        <p className="text-body leading-6 text-muted">{memory.summary}</p>
      </header>

      <Markdown>{memory.body}</Markdown>

      {confirming && (
        <div className="space-y-3 rounded-md border border-stroke bg-surface p-4 shadow-card">
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
            <p role="alert" className="text-xs text-danger">
              {failure}
            </p>
          )}
          <div className="flex gap-2">
            <Button
              variant="danger"
              size="sm"
              onClick={remove}
              disabled={!reason.trim()}
            >
              移入回收站
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setConfirming(false)}
            >
              取消
            </Button>
          </div>
        </div>
      )}
    </article>
  );
}