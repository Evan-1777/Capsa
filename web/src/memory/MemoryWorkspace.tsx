import { Pin, Plus, Search, Settings2 } from "lucide-react";
import { useEffect, useState } from "react";

import { api } from "../api";
import {
  Badge,
  Button,
  EmptyState,
  ErrorBanner,
  IconButton,
  Input,
  Skeleton,
  UnauthorizedState,
} from "../components/ui";
import type { GroupInfo, MemoryDetail } from "../types";
import { useAsync } from "../useAsync";
import { EditDrawer } from "./EditDrawer";
import { MemoryDetailPane } from "./MemoryDetailPane";

export function MemoryWorkspace({
  workspaceId,
  groups,
  onManageGroups,
}: {
  workspaceId: string;
  groups: GroupInfo[];
  onManageGroups: () => void;
}) {
  const [group, setGroup] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [pinnedOnly, setPinnedOnly] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<MemoryDetail | "new" | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (query === "") {
      setDebouncedQuery("");
      return;
    }
    const timer = window.setTimeout(() => setDebouncedQuery(query), 150);
    return () => window.clearTimeout(timer);
  }, [query]);

  const list = useAsync(
    (signal) =>
      api.memories(
        {
          workspace_id: workspaceId,
          group: group ?? undefined,
          query: debouncedQuery || undefined,
          limit: 100,
        },
        signal,
      ),
    [workspaceId, group, debouncedQuery, version],
  );
  const detail = useAsync(
    (signal) => (selected ? api.memory(selected, signal) : Promise.resolve(null)),
    [selected, version],
  );

  const refresh = () => setVersion((current) => current + 1);
  const items = (list.data?.items ?? []).filter((item) => !pinnedOnly || item.pinned);

  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden bg-surface md:grid-cols-[340px_1fr]">
      <section
        aria-label="记忆列表"
        className={`min-h-0 flex-col border-outline-variant md:flex md:border-r ${
          selected ? "hidden" : "flex"
        }`}
      >
        <div className="space-y-2.5 border-b border-outline-variant bg-surface-container px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-on-surface-variant"
                aria-hidden
              />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="检索标题、摘要或标签"
                aria-label="检索记忆"
                className="!rounded-full !border-transparent !bg-surface-container-high pl-9"
              />
            </div>
            <IconButton
              variant="tonal"
              selected={pinnedOnly}
              aria-pressed={pinnedOnly}
              aria-label="只看置顶"
              title="只看置顶"
              onClick={() => setPinnedOnly((current) => !current)}
            >
              <Pin className="h-4 w-4" aria-hidden />
            </IconButton>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <GroupChip active={group === null} onClick={() => setGroup(null)} label="全部" />
            {groups.map((item) => (
              <GroupChip
                key={item.slug}
                active={group === item.slug}
                onClick={() => setGroup(item.slug)}
                label={item.name}
              />
            ))}
            <IconButton
              aria-label="管理分类"
              title="管理分类"
              onClick={onManageGroups}
              className="h-8 w-8"
            >
              <Settings2 className="h-4 w-4" aria-hidden />
            </IconButton>
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
                    className={`md-state-layer relative w-full space-y-1.5 border-b border-outline-variant px-4 py-3 text-left transition-colors focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${
                      selected === item.id ? "bg-secondary-container" : ""
                    }`}
                  >
                    {selected === item.id && (
                      <span className="absolute bottom-0 left-0 top-0 w-1 bg-primary" />
                    )}
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-title-small text-on-surface">{item.title}</span>
                      {item.pinned ? (
                        <Pin
                          className="mt-0.5 h-4 w-4 shrink-0 text-primary"
                          aria-label="已置顶"
                        />
                      ) : null}
                    </div>
                    <p className="line-clamp-2 text-body-small text-on-surface-variant">
                      {item.summary}
                    </p>
                    <div className="flex flex-wrap items-center gap-1.5 text-label-small text-on-surface-variant">
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
        className={`min-h-0 overflow-y-auto bg-surface md:block ${selected ? "block" : "hidden"}`}
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
        className="md-state-layer fixed bottom-20 right-5 z-20 flex h-14 items-center gap-2 rounded-lg bg-primary-container px-4 text-label-large text-on-primary-container shadow-elevation-3 focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary md:bottom-6"
      >
        <Plus className="h-5 w-5" aria-hidden />
        <span>新建记忆</span>
      </button>
    </div>
  );
}

function GroupChip({
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
      className={`md-state-layer rounded-sm border px-3 py-1 text-label-large transition-colors focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${
        active
          ? "border-transparent bg-secondary-container text-on-secondary-container"
          : "border-outline text-on-surface-variant"
      }`}
    >
      {label}
    </button>
  );
}
