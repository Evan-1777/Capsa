import { Clock, Layers, Pin, X } from "lucide-react";
import { useEffect, useState } from "react";

import { api } from "../api";
import {
  Button,
  FormField,
  IconButton,
  Input,
  Select,
  SideSheet,
  Textarea,
} from "../components/ui";
import type { GroupInfo, MemoryDetail, MemoryInput, SimilarItem } from "../types";

const TITLE_MAX = 60;
const SUMMARY_MAX = 200;
const BODY_MAX = 64000;

type LifecycleMode = "normal" | "persistent" | "temporary";

interface FormState {
  group: string;
  title: string;
  summary: string;
  body: string;
  tags: string;
  lifecycle: LifecycleMode;
  expiresLocal: string;
}

export function toLocalDateTimeInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}T${hh}:${min}`;
}

export function futureLocalDateTime(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  date.setHours(23, 59, 0, 0);
  return toLocalDateTimeInput(date.toISOString());
}

export function localDateTimeToUTCISO(localValue: string): string | null {
  if (!localValue.trim()) return null;
  const date = new Date(localValue);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function initialLifecycle(memory: MemoryDetail | null): LifecycleMode {
  if (!memory) return "normal";
  if (memory.persistent) return "persistent";
  if (memory.expires_at) return "temporary";
  return "normal";
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
  const initialMode = initialLifecycle(memory);
  const initialExpiresLocal = toLocalDateTimeInput(memory?.expires_at);

  const [form, setForm] = useState<FormState>({
    group: memory?.group_slug ?? groups[0]?.slug ?? "",
    title: memory?.title ?? "",
    summary: memory?.summary ?? "",
    body: memory?.body ?? "",
    tags: memory?.tags.join(", ") ?? "",
    lifecycle: initialMode,
    expiresLocal: initialExpiresLocal,
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

  function selectLifecycle(mode: LifecycleMode) {
    if (mode === "temporary" && !form.expiresLocal) {
      update({ lifecycle: mode, expiresLocal: futureLocalDateTime(7) });
      return;
    }
    update({ lifecycle: mode });
  }

  const overTitle = form.title.length > TITLE_MAX;
  const overSummary = form.summary.length > SUMMARY_MAX;
  const overBody = form.body.length > BODY_MAX;

  const expiresDate = form.expiresLocal ? new Date(form.expiresLocal) : null;
  const expiresInvalid =
    form.lifecycle === "temporary" &&
    (!expiresDate || Number.isNaN(expiresDate.getTime()) || expiresDate.getTime() <= Date.now());

  const invalid =
    overTitle || overSummary || overBody || !form.title.trim() || !form.group || expiresInvalid;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (invalid) return;
    setBusy(true);
    setFailure(null);
    const tags = form.tags
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);
    try {
      if (memory) {
        const payload: MemoryInput = {};
        if (form.title !== memory.title) payload.title = form.title;
        if (form.summary !== memory.summary) payload.summary = form.summary;
        if (form.body !== memory.body) payload.body = form.body;
        if (tags.join("\u0000") !== memory.tags.join("\u0000")) payload.tags = tags;

        if (form.lifecycle === "normal") {
          if (memory.persistent) payload.persistent = false;
          if (memory.expires_at) payload.clear_expires_at = true;
        } else if (form.lifecycle === "persistent") {
          if (!memory.persistent) payload.persistent = true;
        } else {
          const iso = localDateTimeToUTCISO(form.expiresLocal);
          if (!iso) {
            setFailure("请设置有效的归档时间");
            setBusy(false);
            return;
          }
          if (memory.persistent) payload.persistent = false;
          if (form.expiresLocal !== initialExpiresLocal || initialMode !== "temporary") {
            payload.expires_at = iso;
          }
        }

        if (Object.keys(payload).length === 0) {
          onClose();
          return;
        }
        await api.update(memory.id, payload);
        setDirty(false);
        onSaved(null);
      } else {
        const payload: MemoryInput = {
          group: form.group,
          title: form.title,
          summary: form.summary,
          body: form.body,
          tags,
        };
        if (form.lifecycle === "persistent") {
          payload.persistent = true;
        } else if (form.lifecycle === "temporary") {
          const iso = localDateTimeToUTCISO(form.expiresLocal);
          if (!iso) {
            setFailure("请设置有效的归档时间");
            setBusy(false);
            return;
          }
          payload.expires_at = iso;
        }
        const result = await api.create(payload);
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
    <SideSheet open onClose={requestClose} side="right">
      <form
        onSubmit={submit}
        className="relative flex h-full w-full flex-col bg-surface-container-high text-on-surface md:w-[560px] md:rounded-l-xl md:border-l md:border-outline-variant"
      >
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-outline-variant px-5 py-3">
          <h2 className="text-title-medium text-on-surface">
            {memory ? "编辑记忆" : "新建记忆"}
          </h2>
          <IconButton
            aria-label="关闭"
            title="关闭"
            onClick={requestClose}
            className="!h-8 !w-8"
          >
            <X className="h-4 w-4" aria-hidden />
          </IconButton>
        </header>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {!memory && (
            <FormField label="组别" id="edit-group-select">
              <Select
                id="edit-group-select"
                aria-label="组别"
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

          <div className="space-y-2">
            <span className="block text-label-large text-on-surface">记忆状态</span>
            <div
              role="radiogroup"
              aria-label="记忆状态"
              className="grid grid-cols-3 overflow-hidden rounded-full border border-outline bg-surface-container-low"
            >
              {(
                [
                  { id: "normal", label: "常规", icon: Layers },
                  { id: "persistent", label: "持久", icon: Pin },
                  { id: "temporary", label: "临时", icon: Clock },
                ] as const
              ).map((option, idx) => {
                const Icon = option.icon;
                const active = form.lifecycle === option.id;
                return (
                  <button
                    key={option.id}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => selectLifecycle(option.id)}
                    className={`md-state-layer flex h-9 items-center justify-center gap-1.5 text-label-large transition-colors focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${
                      idx > 0 ? "border-l border-outline" : ""
                    } ${
                      active
                        ? "bg-secondary-container font-medium text-on-secondary-container"
                        : "text-on-surface-variant hover:text-on-surface"
                    }`}
                  >
                    <Icon className="h-3.5 w-3.5" aria-hidden />
                    <span>{option.label}</span>
                  </button>
                );
              })}
            </div>

            {form.lifecycle === "temporary" && (
              <div className="space-y-2 rounded-md border border-outline-variant bg-surface-container p-3">
                <FormField label="自动归档时间" id="edit-expires-at">
                  <Input
                    id="edit-expires-at"
                    type="datetime-local"
                    aria-label="自动归档时间"
                    value={form.expiresLocal}
                    invalid={expiresInvalid}
                    onChange={(event) => update({ expiresLocal: event.target.value })}
                  />
                </FormField>
                <div className="flex flex-wrap items-center gap-1.5">
                  {[
                    { label: "+1天", days: 1 },
                    { label: "+7天", days: 7 },
                    { label: "+30天", days: 30 },
                  ].map((preset) => (
                    <button
                      key={preset.days}
                      type="button"
                      onClick={() => update({ expiresLocal: futureLocalDateTime(preset.days) })}
                      className="md-state-layer rounded-sm border border-outline-variant bg-surface-container-low px-2.5 py-1 text-label-medium text-on-surface-variant transition-colors hover:border-outline hover:text-on-surface"
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
                {expiresInvalid && (
                  <p role="alert" className="text-body-small text-error">
                    归档时间必须晚于当前时间
                  </p>
                )}
              </div>
            )}
          </div>

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
            <div className="space-y-1.5 rounded-md bg-warning-container p-3 text-on-warning-container">
              <p className="text-title-small">已创建，检测到相似标题</p>
              <ul className="space-y-1">
                {similar.map((item) => (
                  <li key={item.id} className="text-body-small">
                    {item.id} · {item.title} · 相似度 {item.similarity}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {failure && (
            <p role="alert" className="text-body-small text-error">
              {failure}
            </p>
          )}
        </div>

        <footer className="flex shrink-0 justify-end gap-2 border-t border-outline-variant px-5 py-3">
          <Button variant="text" size="sm" type="button" onClick={requestClose}>
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
    </SideSheet>
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
          {markdown && (
            <span className="ml-1 text-body-small font-normal text-on-surface-variant">
              Markdown
            </span>
          )}
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
