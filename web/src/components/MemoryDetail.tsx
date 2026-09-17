import { Pencil, Trash2 } from "lucide-react";
import { useState } from "react";

import { api } from "../api";
import type { MemoryDetail } from "../types";
import type { AsyncState } from "../useAsync";
import { Markdown } from "./Markdown";
import { EmptyState, ErrorBanner, Skeleton, UnauthorizedState } from "./States";

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
  const back = (
    <button
      type="button"
      onClick={onBack}
      className="mb-3 rounded border border-zinc-300 px-2.5 py-1 text-xs text-zinc-700 hover:bg-white md:hidden"
    >
      返回列表
    </button>
  );

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
    <article className="mx-auto max-w-3xl space-y-4 px-5 py-6">
      {back}
      <header className="space-y-2 border-b border-zinc-200 pb-4">
        <div className="flex items-start justify-between gap-3">
          <h1 className="text-lg font-semibold leading-7 tracking-tight">{memory.title}</h1>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => onEdit(memory)}
              className="flex items-center gap-1.5 rounded border border-zinc-300 px-2.5 py-1 text-xs text-zinc-700 hover:bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            >
              <Pencil className="h-3.5 w-3.5" aria-hidden />
              编辑
            </button>
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="flex items-center gap-1.5 rounded border border-zinc-300 px-2.5 py-1 text-xs text-zinc-700 hover:bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden />
              删除
            </button>
          </div>
        </div>
        <dl className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-zinc-500">
          <div className="flex gap-1">
            <dt>分组</dt>
            <dd className="text-zinc-700">{memory.group_slug}</dd>
          </div>
          <div className="flex gap-1">
            <dt>更新</dt>
            <dd className="text-zinc-700">{memory.updated_at.slice(0, 10)}</dd>
          </div>
          <div className="flex gap-1">
            <dt>复核</dt>
            <dd className={memory.is_overdue ? "text-amber-700" : "text-zinc-700"}>
              {memory.review_at ? memory.review_at.slice(0, 10) : "未设置"}
              {memory.is_overdue && " · 已过期"}
            </dd>
          </div>
          {memory.tags.length > 0 && (
            <div className="flex gap-1">
              <dt>标签</dt>
              <dd className="text-zinc-700">{memory.tags.join("、")}</dd>
            </div>
          )}
        </dl>
        <p className="text-[13px] leading-6 text-zinc-600">{memory.summary}</p>
      </header>

      <Markdown>{memory.body}</Markdown>

      {confirming && (
        <div className="space-y-2 rounded border border-zinc-200 bg-white p-4">
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-zinc-600">删除原因</span>
            <input
              value={reason}
              aria-label="删除原因"
              onChange={(event) => setReason(event.target.value)}
              placeholder="例如：内容已合并到另一条记忆"
              className="w-full rounded border border-zinc-300 px-3 py-1.5 text-[13px] focus:border-blue-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            />
          </label>
          {failure && (
            <p role="alert" className="text-xs text-red-600">
              {failure}
            </p>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={remove}
              disabled={!reason.trim()}
              className="rounded bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-500 disabled:bg-zinc-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
            >
              移入回收站
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="rounded border border-zinc-300 px-3 py-1.5 text-xs text-zinc-700 hover:bg-zinc-50"
            >
              取消
            </button>
          </div>
        </div>
      )}
    </article>
  );
}
