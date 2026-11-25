import { Archive, Clock, Layers, Pin, Plus, Search, Settings2, type LucideIcon } from "lucide-react";
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
import type { GroupInfo, MemoryDetail, MemoryListItem, MemoryTier } from "../types";
import { useAsync } from "../useAsync";
import { EditDrawer } from "./EditDrawer";
import { MemoryDetailPane } from "./MemoryDetailPane";

const TIER_FILTERS: {
  id: MemoryTier | null;
  label: string;
  icon?: LucideIcon;
}[] = [
  { id: null, label: "全部" },
  { id: "persistent", label: "持久", icon: Pin },
  { id: "temporary", label: "临时", icon: Clock },
  { id: "shallow", label: "浅层", icon: Layers },
  { id: "deep", label: "深层", icon: Archive },
];

export function formatShortDate(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso.slice(5, 10);
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${mm}-${dd}`;
}

export function TierBadge({ item }: { item: Pick<MemoryListItem, "tier" | "expires_at"> }) {
  switch (item.tier) {
    case "persistent":
      return (
        <Badge variant="primary">
          <Pin className="h-3 w-3" aria-hidden />
          <span>持久</span>
        </Badge>
      );
    case "temporary":
      return (
        <Badge variant="warning">
          <Clock className="h-3 w-3" aria-hidden />
          <span>临时{item.expires_at ? ` · ${formatShortDate(item.expires_at)}` : ""}</span>
        </Badge>
      );
    case "shallow":
      return <Badge variant="success">浅层</Badge>;
    case "deep":
      return <Badge variant="neutral">深层</Badge>;
  }
}

export function MemoryWorkspace({
  workspaceId,
  shallowMonths,
  groups,
  onManageGroups,
}: {
  workspaceId: string;
  shallowMonths: number;
  groups: GroupInfo[];
  onManageGroups: () => void;
}) {
  const [group, setGroup] = useState<string | null>(null);
  const [tier, setTier] = useState<MemoryTier | null>(null);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
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
          tier: tier ?? undefined,
          group: group ?? undefined,
          query: debouncedQuery || undefined,
          limit: 100,
        },
        signal,
      ),
    [workspaceId, shallowMonths, tier, group, debouncedQuery, version],
  );
  const detail = useAsync(
    (signal) => (selected ? api.memory(selected, signal) : Promise.resolve(null)),
    [selected, shallowMonths, version],
  );

  const refresh = () => setVersion((current) => current + 1);
  const items = list.data?.items ?? [];

  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden bg-surface md:grid-cols-[348px_1fr]">
      <section
        aria-label="记忆列表"
        className={`min-h-0 flex-col border-outline-variant md:flex md:border-r ${
          selected ? "hidden" : "flex"
        }`}
      >
        <div className="space-y-2.5 border-b border-outline-variant bg-surface-container px-4 py-3">
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-on-surface-variant"
              aria-hidden
            />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="检索标题、摘要或标签"
              aria-label="检索记忆"
              className="!h-9 !rounded-full !border-transparent !bg-surface-container-high pl-9 text-body-small"
            />
          </div>

          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="状态筛选">
            {TIER_FILTERS.map((option) => {
              const Icon = option.icon;
              const active = tier === option.id;
              return (
                <FilterChip
                  key={option.label}
                  active={active}
                  onClick={() => setTier(option.id)}
                  label={option.label}
                  icon={Icon ? <Icon className="h-3.5 w-3.5" aria-hidden /> : undefined}
                />
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="组别筛选">
            <FilterChip active={group === null} onClick={() => setGroup(null)} label="全部组别" />
            {groups.map((item) => (
              <FilterChip
                key={item.slug}
                active={group === item.slug}
                onClick={() => setGroup(item.slug)}
                label={item.name}
              />
            ))}
            <IconButton
              aria-label="管理组别"
              title="管理组别"
              onClick={onManageGroups}
              className="!h-7 !w-7"
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
              {items.map((item) => {
                const isSelected = selected === item.id;
                const isDeep = item.tier === "deep";
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => setSelected(item.id)}
                      aria-current={isSelected ? "page" : undefined}
                      className={`md-state-layer relative w-full space-y-1.5 border-b border-outline-variant px-4 py-3 text-left transition-colors focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${
                        isSelected ? "bg-secondary-container" : ""
                      }`}
                    >
                      {isSelected && (
                        <span className="absolute bottom-0 left-0 top-0 w-1 bg-primary" />
                      )}
                      <div className="flex items-start justify-between gap-2">
                        <span
                          className={`min-w-0 flex-1 text-title-small ${
                            isDeep && !isSelected ? "text-on-surface-variant" : "text-on-surface"
                          }`}
                        >
                          {item.title}
                        </span>
                        <span className="shrink-0">
                          <TierBadge item={item} />
                        </span>
                      </div>
                      <p
                        className={`line-clamp-2 text-body-small ${
                          isDeep && !isSelected
                            ? "text-on-surface-variant/75"
                            : "text-on-surface-variant"
                        }`}
                      >
                        {item.summary}
                      </p>
                      <div className="flex flex-wrap items-center gap-1.5 text-label-small text-on-surface-variant">
                        <span className="font-mono">{item.group_slug}</span>
                        <span>·</span>
                        <span>{item.updated_at.slice(0, 10)}</span>
                        {item.tags.map((tag) => (
                          <Badge key={tag} variant="neutral">
                            {tag}
                          </Badge>
                        ))}
                      </div>
                    </button>
                  </li>
                );
              })}
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

function FilterChip({
  active,
  onClick,
  label,
  icon,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  icon?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`md-state-layer inline-flex items-center gap-1 rounded-sm border px-2.5 py-1 text-label-medium transition-colors focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${
        active
          ? "border-transparent bg-secondary-container font-medium text-on-secondary-container"
          : "border-outline-variant bg-surface-container-low text-on-surface-variant hover:border-outline hover:text-on-surface"
      }`}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}
