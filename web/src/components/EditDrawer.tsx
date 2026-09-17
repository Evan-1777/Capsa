import { useEffect, useState } from "react";

import { api } from "../api";
import type { GroupInfo, MemoryDetail, SimilarItem } from "../types";

const TITLE_MAX = 60;
const SUMMARY_MAX = 200;
const BODY_MAX = 64000;

interface FormState {
  group: string;
  title: string;
  summary: string;
  body: string;
  tags: string;
  reviewDate: string;
}

export function EditDrawer({
  groups,
  memory,
  onClose,
  onCreated,
  onSaved,
}: {
  groups: GroupInfo[];
  memory: MemoryDetail | null;
  onClose: () => void;
  // 新建成功即通知列表刷新；onSaved 另行决定是否关闭抽屉。
  onCreated: () => void;
  onSaved: (createdId: string | null) => void;
}) {
  const [form, setForm] = useState<FormState>({
    group: memory?.group_slug ?? groups[0]?.slug ?? "",
    title: memory?.title ?? "",
    summary: memory?.summary ?? "",
    body: memory?.body ?? "",
    tags: memory?.tags.join(", ") ?? "",
    reviewDate: memory?.review_at?.slice(0, 10) ?? "",
  });
  const [similar, setSimilar] = useState<SimilarItem[]>([]);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const update = (patch: Partial<FormState>) => {
    setForm((current) => ({ ...current, ...patch }));
    setDirty(true);
  };

  const overTitle = form.title.length > TITLE_MAX;
  const overSummary = form.summary.length > SUMMARY_MAX;
  const overBody = form.body.length > BODY_MAX;
  const invalid = overTitle || overSummary || overBody || !form.title.trim() || !form.group;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setFailure(null);
    const tags = form.tags
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);
    try {
      if (memory) {
        const payload: Record<string, unknown> = {};
        if (form.title !== memory.title) payload.title = form.title;
        if (form.summary !== memory.summary) payload.summary = form.summary;
        if (form.body !== memory.body) payload.body = form.body;
        if (tags.join("\u0000") !== memory.tags.join("\u0000")) payload.tags = tags;
        if (form.reviewDate !== (memory.review_at?.slice(0, 10) ?? "")) {
          if (form.reviewDate) payload.review_at = `${form.reviewDate}T00:00:00+00:00`;
          else payload.clear_review_at = true;
        }
        if (Object.keys(payload).length === 0) {
          onClose();
          return;
        }
        await api.update(memory.id, payload);
        setDirty(false);
        onSaved(null);
      } else {
        const result = await api.create({
          group: form.group,
          title: form.title,
          summary: form.summary,
          body: form.body,
          tags,
        });
        setSimilar(result.similar_items);
        setDirty(false);
        onCreated();
        // 有相似条目时保留抽屉展示提示，条目已落库；否则直接进入新建的详情。
        if (result.similar_items.length === 0) onSaved(result.id);
      }
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "保存失败");
    } finally {
      setBusy(false);
    }
  }

  function requestClose() {
    if (dirty && !window.confirm("有未保存的改动，确认关闭？")) return;
    onClose();
  }

  return (
    <div className="fixed inset-0 z-30 flex justify-end">
      <button
        type="button"
        aria-label="关闭编辑抽屉"
        onClick={requestClose}
        className="absolute inset-0 bg-zinc-900/20"
      />
      <form
        onSubmit={submit}
        className="relative flex h-full w-full flex-col bg-white shadow-xl md:w-[560px]"
      >
        <header className="flex items-center justify-between border-b border-zinc-200 px-5 py-3">
          <h2 className="text-sm font-semibold">{memory ? "编辑记忆" : "新建记忆"}</h2>
          <button
            type="button"
            onClick={requestClose}
            className="rounded border border-zinc-300 px-2.5 py-1 text-xs text-zinc-700 hover:bg-zinc-50"
          >
            关闭
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {!memory && (
            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-zinc-600">分组</span>
              <select
                value={form.group}
                aria-label="分组"
                onChange={(event) => update({ group: event.target.value })}
                className="w-full rounded border border-zinc-300 px-3 py-1.5 text-[13px] focus:border-blue-500 focus:outline-none"
              >
                {groups.map((group) => (
                  <option key={group.slug} value={group.slug}>
                    {group.name}
                  </option>
                ))}
              </select>
            </label>
          )}

          <Field
            label="标题"
            value={form.title}
            limit={TITLE_MAX}
            over={overTitle}
            onChange={(value) => update({ title: value })}
          />
          <Field
            label="摘要"
            value={form.summary}
            limit={SUMMARY_MAX}
            over={overSummary}
            onChange={(value) => update({ summary: value })}
            multiline
          />
          <Field
            label="正文"
            value={form.body}
            limit={BODY_MAX}
            over={overBody}
            onChange={(value) => update({ body: value })}
            multiline
            rows={12}
            markdown
          />
          {memory && (
            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-zinc-600">复核时间</span>
              <span className="flex items-center gap-2">
                <input
                  type="date"
                  aria-label="复核时间"
                  value={form.reviewDate}
                  onChange={(event) => update({ reviewDate: event.target.value })}
                  className="rounded border border-zinc-300 px-3 py-1.5 text-[13px] focus:border-blue-500 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => update({ reviewDate: "" })}
                  className="rounded border border-zinc-300 px-2 py-1.5 text-xs text-zinc-700 hover:bg-zinc-50"
                >
                  清除
                </button>
              </span>
            </label>
          )}
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-zinc-600">标签</span>
            <input
              value={form.tags}
              aria-label="标签"
              onChange={(event) => update({ tags: event.target.value })}
              placeholder="逗号分隔"
              className="w-full rounded border border-zinc-300 px-3 py-1.5 text-[13px] focus:border-blue-500 focus:outline-none"
            />
          </label>

          {similar.length > 0 && (
            <div className="space-y-1 rounded border border-amber-200 bg-amber-50 p-3">
              <p className="text-xs font-medium text-amber-900">已创建，检测到相似标题</p>
              <ul className="space-y-1">
                {similar.map((item) => (
                  <li key={item.id} className="text-xs text-amber-800">
                    {item.id} · {item.title} · 相似度 {item.similarity}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {failure && (
            <p role="alert" className="text-xs text-red-600">
              {failure}
            </p>
          )}
        </div>

        <footer className="flex justify-end gap-2 border-t border-zinc-200 px-5 py-3">
          <button
            type="button"
            onClick={requestClose}
            className="rounded border border-zinc-300 px-3 py-1.5 text-xs text-zinc-700 hover:bg-zinc-50"
          >
            取消
          </button>
          <button
            type="submit"
            disabled={invalid || busy}
            className="rounded bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            {memory ? "保存" : "创建"}
          </button>
        </footer>
      </form>
    </div>
  );
}

function Field({
  label,
  value,
  limit,
  over,
  onChange,
  multiline = false,
  rows = 3,
  markdown = false,
}: {
  label: string;
  value: string;
  limit: number;
  over: boolean;
  onChange: (value: string) => void;
  multiline?: boolean;
  rows?: number;
  markdown?: boolean;
}) {
  const shared = `w-full rounded border px-3 py-1.5 text-[13px] focus:outline-none ${over ? "border-red-400 focus:border-red-500" : "border-zinc-300 focus:border-blue-500"}`;
  return (
    <label className="block space-y-1.5">
      <span className="flex items-center justify-between text-xs font-medium text-zinc-600">
        <span>
          {label}
          {markdown && <span className="ml-1 font-normal text-zinc-400">Markdown</span>}
        </span>
        <span className={over ? "text-red-600" : "text-zinc-400"}>
          {value.length}/{limit}
        </span>
      </span>
      {multiline ? (
        <textarea
          value={value}
          rows={rows}
          aria-label={label}
          onChange={(event) => onChange(event.target.value)}
          className={shared}
        />
      ) : (
        <input
          value={value}
          aria-label={label}
          onChange={(event) => onChange(event.target.value)}
          className={shared}
        />
      )}
    </label>
  );
}
