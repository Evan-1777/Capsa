import { Pencil, Plus } from "lucide-react";
import { useState } from "react";

import { api } from "../api";
import type { GroupInfo } from "../types";
import { EmptyState, ErrorBanner } from "./States";

const SLUG_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/;
const NAME_MAX = 60;
const DESC_MAX = 200;

type Editing = { mode: "create" } | { mode: "edit"; group: GroupInfo };

export function GroupManager({
  groups,
  onGroupsChange,
}: {
  groups: GroupInfo[];
  onGroupsChange: () => Promise<void>;
}) {
  const [editing, setEditing] = useState<Editing | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  async function refresh() {
    try {
      await onGroupsChange();
      setFailure(null);
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "分类列表刷新失败");
    }
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-3xl space-y-4 px-5 py-6">
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-sm font-semibold tracking-tight">分类管理</h1>
          <button
            type="button"
            onClick={() => setEditing({ mode: "create" })}
            className="flex items-center gap-1.5 rounded bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden />
            新建分类
          </button>
        </div>

        {failure && <ErrorBanner message={failure} onRetry={refresh} />}

        {groups.length === 0 ? (
          <EmptyState
            message="暂无分类"
            action={
              <button
                type="button"
                onClick={() => setEditing({ mode: "create" })}
                className="rounded bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-800"
              >
                新建分类
              </button>
            }
          />
        ) : (
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {groups.map((group) => (
              <li
                key={group.slug}
                className="space-y-2 border border-zinc-200 bg-white p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <p className="truncate text-[13px] font-medium text-zinc-900">{group.name}</p>
                    <p className="truncate font-mono text-[11px] text-zinc-400">{group.slug}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setEditing({ mode: "edit", group })}
                    className="flex shrink-0 items-center gap-1.5 rounded border border-zinc-300 px-2.5 py-1 text-xs text-zinc-700 hover:bg-zinc-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                  >
                    <Pencil className="h-3 w-3" aria-hidden />
                    编辑
                  </button>
                </div>
                <p className="line-clamp-2 text-xs leading-5 text-zinc-500">
                  {group.description || "暂无描述"}
                </p>
                <p className="text-[11px] text-zinc-400">{group.count} 条记忆</p>
              </li>
            ))}
          </ul>
        )}
      </div>

      {editing && (
        <GroupDialog
          editing={editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            await refresh();
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function GroupDialog({
  editing,
  onClose,
  onSaved,
}: {
  editing: Editing;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const existing = editing.mode === "edit" ? editing.group : null;
  const [slug, setSlug] = useState(existing?.slug ?? "");
  const [name, setName] = useState(existing?.name ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const slugInvalid = !existing && !SLUG_PATTERN.test(slug);
  const nameInvalid = !name.trim() || name.length > NAME_MAX;
  const invalid = slugInvalid || nameInvalid || description.length > DESC_MAX;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setFailure(null);
    try {
      if (existing) {
        await api.updateGroup(existing.slug, { name, description });
      } else {
        await api.createGroup({ slug, name, description });
      }
      await onSaved();
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "保存失败");
      setBusy(false);
    }
  }

  const shared = "w-full rounded border border-zinc-300 px-3 py-1.5 text-[13px] focus:border-blue-500 focus:outline-none disabled:bg-zinc-100 disabled:text-zinc-500";

  return (
    <div className="fixed inset-0 z-30 grid place-items-center p-4">
      <button
        type="button"
        aria-label="关闭分类编辑"
        onClick={onClose}
        className="absolute inset-0 bg-zinc-900/20"
      />
      <form
        onSubmit={submit}
        className="relative w-full max-w-md space-y-4 rounded-lg border border-zinc-200 bg-white p-5 shadow-xl"
      >
        <h2 className="text-sm font-semibold">{existing ? "编辑分类" : "新建分类"}</h2>

        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-zinc-600">分类标识</span>
          <input
            value={slug}
            aria-label="分类标识"
            disabled={Boolean(existing)}
            onChange={(event) => setSlug(event.target.value)}
            placeholder="research"
            className={shared + " font-mono"}
          />
          <span className="block text-[11px] text-zinc-400">
            {existing ? "标识不可修改" : "字母、数字、下划线或连字符，创建后不可修改"}
          </span>
        </label>

        <label className="block space-y-1.5">
          <span className="flex items-center justify-between text-xs font-medium text-zinc-600">
            <span>分类名称</span>
            <span className={name.length > NAME_MAX ? "text-red-600" : "text-zinc-400"}>
              {name.length}/{NAME_MAX}
            </span>
          </span>
          <input
            value={name}
            aria-label="分类名称"
            onChange={(event) => setName(event.target.value)}
            className={shared}
          />
        </label>

        <label className="block space-y-1.5">
          <span className="flex items-center justify-between text-xs font-medium text-zinc-600">
            <span>分类描述</span>
            <span className={description.length > DESC_MAX ? "text-red-600" : "text-zinc-400"}>
              {description.length}/{DESC_MAX}
            </span>
          </span>
          <textarea
            value={description}
            aria-label="分类描述"
            rows={3}
            onChange={(event) => setDescription(event.target.value)}
            className={shared}
          />
        </label>

        {failure && (
          <p role="alert" className="text-xs text-red-600">
            {failure}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-zinc-300 px-3 py-1.5 text-xs text-zinc-700 hover:bg-zinc-50"
          >
            取消
          </button>
          <button
            type="submit"
            disabled={invalid || busy}
            className="rounded bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            {existing ? "保存" : "创建"}
          </button>
        </div>
      </form>
    </div>
  );
}
