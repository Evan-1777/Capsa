import { Pin, Plus, Search, Settings2 } from "lucide-react";
import { useState } from "react";

import { api } from "../api";
import type { GroupInfo, MemoryDetail } from "../types";
import { useAsync } from "../useAsync";
import { EditDrawer } from "./EditDrawer";
import { MemoryDetailPane } from "./MemoryDetail";
import {
  Badge,
  Button,
  EmptyState,
  ErrorBanner,
  Input,
  Skeleton,
  UnauthorizedState,
} from "./ui";

export function MemoryWorkspace({
  groups,
  onManageGroups,
}: {
  groups: GroupInfo[];
  onManageGroups: () => void;
}) {
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

  return (
    <div className="grid flex-1 grid-cols-1 overflow-hidden bg-background md:grid-cols-[320px_1fr]">
      <section
        aria-label="记忆列表"
        className={`min-h-0 flex-col border-stroke md:flex md:border-r ${
          selected ? "hidden" : "flex"
        }`}
      >
        <div className="space-y-2.5 border-b border-stroke bg-acrylic backdrop-blur-md px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search
                className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-subtle"
                aria-hidden
              />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="检索标题、摘要或标签"
                aria-label="检索记忆"
                className="pl-8"
              />
            </div>
            <button
              type="button"
              onClick={() => setPinnedOnly((current) => !current)}
              aria-pressed={pinnedOnly}
              title="只看置顶"
              className={`rounded border p-2 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand ${
                pinnedOnly
                  ? "border-brand bg-brand/10 text-brand"
                  : "border-stroke bg-surface text-muted hover:text-foreground hover:bg-background"
              }`}
            >
              <Pin className="h-3.5 w-3.5" aria-hidden />
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <GroupPill active={group === null} onClick={() => setGroup(null)} label="全部" />
            {groups.map((item) => (
              <GroupPill
                key={item.slug}
                active={group === item.slug}
                onClick={() => setGroup(item.slug)}
                label={item.name}
              />
            ))}
            <button
              type="button"
              onClick={onManageGroups}
              title="管理分类"
              aria-label="管理分类"
              className="rounded-full border border-stroke bg-surface p-1 text-muted hover:text-foreground hover:bg-background focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            >
              <Settings2 className="h-3.5 w-3.5" aria-hidden />
            </button>
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
                <Button variant="primary" size="sm" onClick={() => setEditing("new")}>
                  新建记忆
                </Button>
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
                    className={`relative w-full space-y-1.5 border-b border-stroke px-4 py-3 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand ${
                      selected === item.id ? "bg-surface shadow-card" : "hover:bg-surface/60"
                    }`}
                  >
                    {selected === item.id && (
                      <span className="absolute bottom-0 left-0 top-0 w-1 bg-brand" />
                    )}
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-body font-semibold leading-5 text-foreground">
                        {item.title}
                      </span>
                      {item.pinned ? (
                        <Pin
                          className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand"
                          aria-label="已置顶"
                        />
                      ) : null}
                    </div>
                    <p className="line-clamp-2 text-xs leading-5 text-muted">{item.summary}</p>
                    <div className="flex flex-wrap items-center gap-1.5 text-caption text-subtle">
                      <span>{item.group_slug}</span>
                      <span>·</span>
                      <span>{item.updated_at.slice(0, 10)}</span>
                      {item.is_overdue && <Badge variant="warning">已过期</Badge>}
                      {item.tags.map((tag) => (
                        <Badge key={tag} variant="neutral">
                          {tag}
                        </Badge>
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
        className={`min-h-0 overflow-y-auto bg-surface md:block ${
          selected ? "block" : "hidden"
        }`}
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

      <button
        type="button"
        onClick={() => setEditing("new")}
        className="fixed bottom-20 right-5 z-20 flex items-center gap-1.5 rounded-full bg-brand px-4 py-2.5 text-xs font-medium text-white shadow-dialog transition-colors hover:bg-brand-hover active:bg-brand-pressed focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 md:bottom-6"
      >
        <Plus className="h-3.5 w-3.5" aria-hidden />
        <span>新建记忆</span>
      </button>
    </div>
  );
}

function GroupPill({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-full border px-2.5 py-0.5 text-xs transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand ${
        active
          ? "border-brand bg-brand text-white"
          : "border-stroke bg-surface text-foreground hover:bg-background"
      }`}
    >
      {label}
    </button>
  );
}