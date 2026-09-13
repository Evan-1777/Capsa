import { Pin, Plus, Search } from "lucide-react";
import { useState } from "react";

import { api } from "../api";
import type { GroupInfo, MemoryDetail } from "../types";
import { useAsync } from "../useAsync";
import { EditDrawer } from "./EditDrawer";
import { MemoryDetailPane } from "./MemoryDetail";
import { EmptyState, ErrorBanner, Skeleton, UnauthorizedState } from "./States";

export function MemoryWorkspace({ groups }: { groups: GroupInfo[] }) {
  const [group, setGroup] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [pinnedOnly, setPinnedOnly] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<MemoryDetail | "new" | null>(null);
  const [version, setVersion] = useState(0);

  const list = useAsync(
    () => api.memories({ group: group ?? undefined, query: query || undefined, limit: 100 }),
    [group, query, version],
  );
  const detail = useAsync(
    () => (selected ? api.memory(selected) : Promise.resolve(null)),
    [selected, version],
  );

  const refresh = () => setVersion((current) => current + 1);
  const items = (list.data?.items ?? []).filter((item) => !pinnedOnly || item.pinned);
  const writable = (item: { permission: string }) => item.permission === "rw";

  return (
    <div className="grid flex-1 grid-cols-1 overflow-hidden md:grid-cols-[320px_1fr]">
      <section
        aria-label="记忆列表"
        className={`min-h-0 flex-col border-zinc-200 md:flex md:border-r ${selected ? "hidden" : "flex"}`}
      >
        <div className="space-y-2 border-b border-zinc-200 bg-white px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-2 top-2.5 h-3.5 w-3.5 text-zinc-400" aria-hidden />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="检索标题、摘要或标签"
                aria-label="检索记忆"
                className="w-full rounded border border-zinc-300 py-1.5 pl-7 pr-2 text-[13px] focus:border-blue-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
              />
            </div>
            <button
              type="button"
              onClick={() => setPinnedOnly((current) => !current)}
              aria-pressed={pinnedOnly}
              title="只看置顶"
              className={`rounded border px-2 py-1.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${pinnedOnly ? "border-blue-500 text-blue-700" : "border-zinc-300 text-zinc-500 hover:bg-zinc-50"}`}
            >
              <Pin className="h-3.5 w-3.5" aria-hidden />
            </button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <GroupPill active={group === null} onClick={() => setGroup(null)} label="全部" />
            {groups.map((item) => (
              <GroupPill
                key={item.slug}
                active={group === item.slug}
                onClick={() => setGroup(item.slug)}
                label={item.name}
                permission={item.permission}
              />
            ))}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {list.loading ? (
            <Skeleton rows={5} />
          ) : list.error?.code === "UNAUTHORIZED" ? (
            <UnauthorizedState />
          ) : list.error ? (
            <ErrorBanner message={list.error.message} onRetry={list.reload} />
          ) : items.length === 0 ? (
            <EmptyState
              message="暂无匹配记忆"
              action={
                groups.some((item) => item.permission === "rw") ? (
                  <button
                    type="button"
                    onClick={() => setEditing("new")}
                    className="rounded bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-800"
                  >
                    新建记忆
                  </button>
                ) : undefined
              }
            />
          ) : (
            <ul>
              {items.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => setSelected(item.id)}
                    aria-current={selected === item.id}
                    className={`w-full space-y-1 border-b border-zinc-100 px-4 py-3 text-left hover:bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500 ${selected === item.id ? "bg-white" : ""}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-[13px] font-medium leading-5 text-zinc-900">{item.title}</span>
                      {item.pinned ? <Pin className="mt-0.5 h-3 w-3 shrink-0 text-blue-600" aria-label="已置顶" /> : null}
                    </div>
                    <p className="line-clamp-2 text-xs leading-5 text-zinc-500">{item.summary}</p>
                    <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-zinc-400">
                      <span>{item.group_slug}</span>
                      <span>·</span>
                      <span>{item.updated_at.slice(0, 10)}</span>
                      {item.is_overdue && <span className="text-amber-700">已过期</span>}
                      {!writable(item) && <span className="text-zinc-400">只读</span>}
                      {item.tags.map((tag) => (
                        <span key={tag} className="rounded bg-zinc-100 px-1.5 py-0.5 text-zinc-500">
                          {tag}
                        </span>
                      ))}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section
        aria-label="记忆详情"
        className={`min-h-0 overflow-y-auto bg-zinc-50 md:block ${selected ? "block" : "hidden"}`}
      >
        <MemoryDetailPane
          state={detail}
          onEdit={(memory) => setEditing(memory)}
          onDeleted={() => {
            setSelected(null);
            refresh();
          }}
          onBack={() => setSelected(null)}
        />
      </section>

      {editing && (
        <EditDrawer
          groups={groups}
          memory={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onCreated={refresh}
          onSaved={(created) => {
            setEditing(null);
            if (created) setSelected(created);
            refresh();
          }}
        />
      )}

      {groups.some((item) => item.permission === "rw") && (
        <button
          type="button"
          onClick={() => setEditing("new")}
          className="fixed bottom-20 right-5 z-20 flex items-center gap-1.5 rounded-full bg-zinc-900 px-4 py-2.5 text-xs font-medium text-white shadow-lg hover:bg-zinc-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 md:bottom-6"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden />
          新建记忆
        </button>
      )}
    </div>
  );
}

function GroupPill({
  active,
  onClick,
  label,
  permission,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  permission?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-full border px-2.5 py-0.5 text-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${active ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-300 text-zinc-600 hover:bg-zinc-50"}`}
    >
      {label}
      {permission === "r" && <span className="ml-1 text-[10px] opacity-70">只读</span>}
    </button>
  );
}
