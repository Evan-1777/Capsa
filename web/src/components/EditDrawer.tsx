import { useEffect, useRef, useState } from "react";

import { api } from "../api";
import type { GroupInfo, MemoryDetail, SimilarItem } from "../types";
import { Button, FormField, Input, Select, Textarea } from "./ui";

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
  onCreated: () => void;
  onSaved: (createdId: string | null) => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
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
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!dialog.open) {
      dialog.showModal();
    }
    return () => {
      if (dialog.open) dialog.close();
    };
  }, []);

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
    <dialog
      ref={dialogRef}
      onCancel={(e) => {
        e.preventDefault();
        requestClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          requestClose();
        }
      }}
      className="fixed inset-0 m-0 flex h-screen w-screen max-h-none max-w-none justify-end border-0 bg-black/40 p-0 backdrop-blur-sm z-50"
    >
      <form
        onSubmit={submit}
        className="relative flex h-full w-full flex-col bg-surface shadow-dialog md:w-[560px]"
      >
        <header className="flex items-center justify-between border-b border-stroke px-5 py-3">
          <h2 className="text-sm font-semibold text-foreground">
            {memory ? "编辑记忆" : "新建记忆"}
          </h2>
          <Button variant="secondary" size="sm" type="button" onClick={requestClose}>
            关闭
          </Button>
        </header>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {!memory && (
            <FormField label="分组" id="edit-group-select">
              <Select
                id="edit-group-select"
                aria-label="分组"
                value={form.group}
                onChange={(event) => update({ group: event.target.value })}
              >
                {groups.map((group) => (
                  <option key={group.slug} value={group.slug}>
                    {group.name}
                  </option>
                ))}
              </Select>
            </FormField>
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
            <FormField label="复核时间" id="edit-review-date">
              <div className="flex items-center gap-2">
                <Input
                  id="edit-review-date"
                  type="date"
                  aria-label="复核时间"
                  value={form.reviewDate}
                  onChange={(event) => update({ reviewDate: event.target.value })}
                />
                <Button
                  variant="secondary"
                  size="sm"
                  type="button"
                  onClick={() => update({ reviewDate: "" })}
                >
                  清除
                </Button>
              </div>
            </FormField>
          )}

          <FormField label="标签" id="edit-tags-input">
            <Input
              id="edit-tags-input"
              value={form.tags}
              aria-label="标签"
              onChange={(event) => update({ tags: event.target.value })}
              placeholder="逗号分隔"
            />
          </FormField>

          {similar.length > 0 && (
            <div className="space-y-1.5 rounded border border-warning/30 bg-warning/10 p-3">
              <p className="text-xs font-medium text-warning">已创建，检测到相似标题</p>
              <ul className="space-y-1">
                {similar.map((item) => (
                  <li key={item.id} className="text-xs text-foreground">
                    {item.id} · {item.title} · 相似度 {item.similarity}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {failure && (
            <p role="alert" className="text-xs text-danger">
              {failure}
            </p>
          )}
        </div>

        <footer className="flex justify-end gap-2 border-t border-stroke px-5 py-3">
          <Button variant="secondary" size="sm" type="button" onClick={requestClose}>
            取消
          </Button>
          <Button
            variant="primary"
            size="sm"
            type="submit"
            disabled={invalid || busy}
            busy={busy}
            busyText={memory ? "正在保存..." : "正在创建..."}
          >
            {memory ? "保存" : "创建"}
          </Button>
        </footer>
      </form>
    </dialog>
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
  return (
    <FormField
      label={
        <span>
          {label}
          {markdown && <span className="ml-1 text-caption font-normal text-muted">Markdown</span>}
        </span>
      }
      counter={{
        current: value.length,
        max: limit,
        over,
      }}
    >
      {multiline ? (
        <Textarea
          value={value}
          aria-label={label}
          rows={rows}
          invalid={over}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : (
        <Input
          value={value}
          aria-label={label}
          invalid={over}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </FormField>
  );
}
