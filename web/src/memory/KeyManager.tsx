import {
  AlertTriangle,
  Ban,
  Check,
  Copy,
  Eye,
  Lock,
  Minus,
  Pencil,
  Plus,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { api } from "../api";
import {
  Badge,
  Button,
  Card,
  Dialog,
  EmptyState,
  ErrorBanner,
  FormField,
  IconButton,
  Input,
  Skeleton,
} from "../components/ui";
import type {
  CreatedKeyResult,
  GroupInfo,
  KeyRecord,
  Permission,
  WorkspaceInfo,
} from "../types";

const NAME_MAX = 60;

type KeyFormState = { mode: "create" } | { mode: "edit"; keyRecord: KeyRecord };
type ScopeMode = "all_rw" | "all_r" | "custom";
type GroupPerm = "none" | "r" | "rw";

function formatTime(iso: string | null): string {
  if (!iso) return "从未调用";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

export function KeyManager({
  workspaces,
  currentKeyId,
  onUpdateCurrentKeyName,
}: {
  workspaces: WorkspaceInfo[];
  currentKeyId: string;
  onUpdateCurrentKeyName: (nextName: string) => void;
}) {
  const [keys, setKeys] = useState<KeyRecord[]>([]);
  const [allGroups, setAllGroups] = useState<GroupInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<string | null>(null);

  const [formState, setFormState] = useState<KeyFormState | null>(null);
  const [disclosureResult, setDisclosureResult] = useState<CreatedKeyResult | null>(null);
  const [revokingKey, setRevokingKey] = useState<KeyRecord | null>(null);
  const [deletingKey, setDeletingKey] = useState<KeyRecord | null>(null);

  const loadData = useCallback(async () => {
    try {
      setFailure(null);
      const [keysRes, groupsRes] = await Promise.all([api.keys(), api.groups()]);
      setKeys(keysRes.items);
      setAllGroups(groupsRes.items);
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "凭据列表加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-surface">
      <div className="mx-auto max-w-3xl space-y-4 px-5 py-6">
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-headline-small text-on-surface">凭据管理</h1>
          <Button variant="primary" size="sm" onClick={() => setFormState({ mode: "create" })}>
            <Plus className="h-4 w-4" aria-hidden />
            <span>签发 Key</span>
          </Button>
        </div>

        {failure && <ErrorBanner message={failure} onRetry={loadData} />}

        {loading ? (
          <Skeleton rows={3} />
        ) : keys.length === 0 ? (
          <EmptyState
            message="暂无凭据"
            action={
              <Button variant="primary" size="sm" onClick={() => setFormState({ mode: "create" })}>
                签发 Key
              </Button>
            }
          />
        ) : (
          <ul className="space-y-3">
            {keys.map((key) => {
              const isCurrent = key.id === currentKeyId;
              const isRevoked = Boolean(key.revoked_at);

              return (
                <Card as="li" key={key.id} className="space-y-3 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <span className="truncate text-title-small text-on-surface">{key.name}</span>
                      <span className="font-mono text-body-small text-on-surface-variant">
                        {key.id}
                      </span>
                      {isCurrent && <Badge variant="primary">当前</Badge>}
                      {isRevoked ? (
                        <Badge variant="neutral">已吊销</Badge>
                      ) : (
                        <Badge variant="success">有效</Badge>
                      )}
                    </div>

                    <div className="flex shrink-0 items-center gap-1">
                      {!isRevoked && (
                        <IconButton
                          variant="tonal"
                          aria-label={`编辑凭据 ${key.name}`}
                          title="编辑"
                          onClick={() => setFormState({ mode: "edit", keyRecord: key })}
                          className="!h-8 !w-8"
                        >
                          <Pencil className="h-4 w-4" aria-hidden />
                        </IconButton>
                      )}
                      {isCurrent ? (
                        <span
                          title="当前会话凭据权限锁定"
                          className="inline-flex h-8 w-8 items-center justify-center text-on-surface-variant"
                        >
                          <Lock className="h-4 w-4" aria-label="当前会话锁定" />
                        </span>
                      ) : !isRevoked ? (
                        <IconButton
                          aria-label={`吊销凭据 ${key.name}`}
                          title="吊销"
                          onClick={() => setRevokingKey(key)}
                          className="!h-8 !w-8 text-warning"
                        >
                          <Ban className="h-4 w-4" aria-hidden />
                        </IconButton>
                      ) : (
                        <IconButton
                          aria-label={`删除凭据 ${key.name}`}
                          title="删除"
                          onClick={() => setDeletingKey(key)}
                          className="!h-8 !w-8 text-error"
                        >
                          <Trash2 className="h-4 w-4" aria-hidden />
                        </IconButton>
                      )}
                    </div>
                  </div>

                  <ScopeChips scopes={key.scopes} />

                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-label-small text-on-surface-variant">
                    <span>创建于 {formatTime(key.created_at)}</span>
                    <span>最后调用 {formatTime(key.last_used_at)}</span>
                    {isRevoked && <span>吊销于 {formatTime(key.revoked_at)}</span>}
                  </div>
                </Card>
              );
            })}
          </ul>
        )}
      </div>

      {formState && (
        <KeyFormDialog
          state={formState}
          groups={allGroups}
          workspaces={workspaces}
          isCurrent={formState.mode === "edit" && formState.keyRecord.id === currentKeyId}
          onClose={() => setFormState(null)}
          onCreated={(result) => {
            setFormState(null);
            setDisclosureResult(result);
            void loadData();
          }}
          onUpdated={(updated) => {
            setFormState(null);
            if (updated.id === currentKeyId) {
              onUpdateCurrentKeyName(updated.name);
            }
            void loadData();
          }}
        />
      )}

      {disclosureResult && (
        <DisclosureDialog
          result={disclosureResult}
          onClose={() => setDisclosureResult(null)}
        />
      )}

      {revokingKey && (
        <RevokeKeyDialog
          keyRecord={revokingKey}
          onClose={() => setRevokingKey(null)}
          onRevoked={async () => {
            await loadData();
            setRevokingKey(null);
          }}
        />
      )}

      {deletingKey && (
        <DeleteKeyDialog
          keyRecord={deletingKey}
          onClose={() => setDeletingKey(null)}
          onDeleted={async () => {
            await loadData();
            setDeletingKey(null);
          }}
        />
      )}
    </div>
  );
}

function ScopeChips({ scopes }: { scopes: Record<string, Permission> }) {
  if (scopes["*"] === "rw") {
    return (
      <div className="flex flex-wrap gap-1.5">
        <Badge variant="primary">
          <ShieldCheck className="h-3 w-3" aria-hidden />
          <span>全局读写</span>
        </Badge>
      </div>
    );
  }
  if (scopes["*"] === "r") {
    return (
      <div className="flex flex-wrap gap-1.5">
        <Badge variant="neutral">
          <Eye className="h-3 w-3" aria-hidden />
          <span>全局只读</span>
        </Badge>
      </div>
    );
  }
  const entries = Object.entries(scopes).sort(([a], [b]) => a.localeCompare(b));
  if (entries.length === 0) {
    return (
      <div className="flex flex-wrap gap-1.5">
        <Badge variant="neutral">无权限</Badge>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {entries.map(([slug, perm]) => (
        <Badge key={slug} variant={perm === "rw" ? "primary" : "neutral"} className="font-mono">
          {slug} · {perm === "rw" ? "RW" : "R"}
        </Badge>
      ))}
    </div>
  );
}

function deriveScopeMode(scopes: Record<string, Permission> | undefined): ScopeMode {
  if (!scopes) return "all_rw";
  if (scopes["*"] === "rw") return "all_rw";
  if (scopes["*"] === "r") return "all_r";
  return "custom";
}

function KeyFormDialog({
  state,
  groups,
  workspaces,
  isCurrent,
  onClose,
  onCreated,
  onUpdated,
}: {
  state: KeyFormState;
  groups: GroupInfo[];
  workspaces: WorkspaceInfo[];
  isCurrent: boolean;
  onClose: () => void;
  onCreated: (result: CreatedKeyResult) => void;
  onUpdated: (updated: KeyRecord) => void;
}) {
  const existing = state.mode === "edit" ? state.keyRecord : null;
  const [name, setName] = useState(existing?.name ?? "");
  const [mode, setMode] = useState<ScopeMode>(() => deriveScopeMode(existing?.scopes));
  const [customScopes, setCustomScopes] = useState<Record<string, GroupPerm>>(() => {
    const initial: Record<string, GroupPerm> = {};
    for (const g of groups) {
      const existingPerm = existing?.scopes[g.slug];
      initial[g.slug] = existingPerm === "r" || existingPerm === "rw" ? existingPerm : "none";
    }
    return initial;
  });
  const [groupFilter, setGroupFilter] = useState("");
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const memoryWorkspaces = useMemo(
    () => workspaces.filter((ws) => ws.mode === "memory"),
    [workspaces],
  );
  const workspaceNameMap = useMemo(
    () => new Map(memoryWorkspaces.map((ws) => [ws.id, ws.name])),
    [memoryWorkspaces],
  );

  const filteredGroups = useMemo(() => {
    const needle = groupFilter.trim().toLowerCase();
    if (!needle) return groups;
    return groups.filter(
      (g) => g.name.toLowerCase().includes(needle) || g.slug.toLowerCase().includes(needle),
    );
  }, [groups, groupFilter]);

  const groupedByWorkspace = useMemo(() => {
    const map = new Map<string, GroupInfo[]>();
    for (const g of filteredGroups) {
      const list = map.get(g.workspace_id) ?? [];
      list.push(g);
      map.set(g.workspace_id, list);
    }
    return Array.from(map.entries()).map(([wsId, items]) => ({
      workspaceId: wsId,
      workspaceName: workspaceNameMap.get(wsId) ?? wsId,
      items,
    }));
  }, [filteredGroups, workspaceNameMap]);

  const selectedCount = useMemo(
    () => Object.values(customScopes).filter((v) => v === "r" || v === "rw").length,
    [customScopes],
  );

  const nameInvalid = !name.trim() || name.length > NAME_MAX;
  const customEmpty = !isCurrent && mode === "custom" && selectedCount === 0;
  const invalid = nameInvalid || customEmpty;

  function applyBatch(perm: GroupPerm) {
    setCustomScopes((prev) => {
      const next = { ...prev };
      for (const g of filteredGroups) {
        next[g.slug] = perm;
      }
      return next;
    });
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (invalid) return;

    let scopes: Record<string, Permission>;
    if (isCurrent || mode === "all_rw") {
      scopes = { "*": "rw" };
    } else if (mode === "all_r") {
      scopes = { "*": "r" };
    } else {
      scopes = {};
      for (const [slug, perm] of Object.entries(customScopes)) {
        if (perm === "r" || perm === "rw") {
          scopes[slug] = perm;
        }
      }
    }

    setBusy(true);
    setFailure(null);
    try {
      if (existing) {
        const updated = await api.updateKey(
          existing.id,
          isCurrent ? { name: name.trim() } : { name: name.trim(), scopes },
        );
        onUpdated(updated);
      } else {
        const result = await api.createKey({ name: name.trim(), scopes });
        onCreated(result);
      }
    } catch (error) {
      setFailure(error instanceof Error ? error.message : existing ? "保存失败" : "签发失败");
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      panelClassName="!max-w-lg max-h-[90vh] overflow-y-auto"
    >
      <form onSubmit={submit} className="space-y-4">
        <h2 className="text-title-large text-on-surface">
          {existing ? "编辑 Key" : "签发新 Key"}
        </h2>

        <FormField
          label="Key 名称"
          id="key-name-input"
          counter={{
            current: name.length,
            max: NAME_MAX,
            over: name.length > NAME_MAX,
          }}
        >
          <Input
            id="key-name-input"
            value={name}
            aria-label="Key 名称"
            placeholder="例如：Claude Desktop"
            invalid={name.length > NAME_MAX}
            onChange={(e) => setName(e.target.value)}
          />
        </FormField>

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-label-large text-on-surface">权限范围</span>
            {isCurrent && (
              <span className="inline-flex items-center gap-1 text-label-small text-on-surface-variant">
                <Lock className="h-3.5 w-3.5" aria-hidden />
                <span>当前凭据已锁定</span>
              </span>
            )}
          </div>

          <div
            role="radiogroup"
            aria-label="权限模式"
            className={`grid grid-cols-3 overflow-hidden rounded-full border border-outline bg-surface-container-low ${
              isCurrent ? "opacity-60" : ""
            }`}
          >
            {(
              [
                { id: "all_rw", label: "全局读写", icon: ShieldCheck },
                { id: "all_r", label: "全局只读", icon: Eye },
                { id: "custom", label: "按组别配置", icon: SlidersHorizontal },
              ] as const
            ).map((option, idx) => {
              const Icon = option.icon;
              const active = (isCurrent ? "all_rw" : mode) === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  disabled={isCurrent}
                  onClick={() => setMode(option.id)}
                  className={`md-state-layer flex h-9 items-center justify-center gap-1.5 text-label-medium transition-colors focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary disabled:cursor-not-allowed ${
                    idx > 0 ? "border-l border-outline" : ""
                  } ${
                    active
                      ? "bg-secondary-container font-medium text-on-secondary-container"
                      : "text-on-surface-variant hover:text-on-surface"
                  }`}
                >
                  <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
                  <span className="truncate">{option.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {!isCurrent && mode === "custom" && (
          <div className="space-y-2.5 border-t border-outline-variant pt-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="text-label-large text-on-surface">组别权限</span>
                <Badge variant={selectedCount > 0 ? "primary" : "neutral"}>
                  已选 {selectedCount}
                </Badge>
              </div>
              <div className="flex items-center gap-1">
                <Button variant="text" size="sm" type="button" className="!h-7 !px-2" onClick={() => applyBatch("none")}>
                  全清空
                </Button>
                <Button variant="text" size="sm" type="button" className="!h-7 !px-2" onClick={() => applyBatch("r")}>
                  全只读
                </Button>
                <Button variant="text" size="sm" type="button" className="!h-7 !px-2" onClick={() => applyBatch("rw")}>
                  全读写
                </Button>
              </div>
            </div>

            {groups.length > 6 && (
              <div className="relative">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-on-surface-variant"
                  aria-hidden
                />
                <Input
                  value={groupFilter}
                  onChange={(e) => setGroupFilter(e.target.value)}
                  placeholder="筛选组别名称或标识"
                  aria-label="筛选组别"
                  className="!h-8 !rounded-full !border-transparent !bg-surface-container-highest pl-9 text-body-small"
                />
              </div>
            )}

            {customEmpty && (
              <p role="alert" className="text-body-small text-error">
                请至少为一个组别授予权限
              </p>
            )}

            {groups.length === 0 ? (
              <p className="text-body-medium text-on-surface-variant">暂无组别</p>
            ) : filteredGroups.length === 0 ? (
              <p className="text-body-small text-on-surface-variant">无匹配组别</p>
            ) : (
              <div className="max-h-64 space-y-2 overflow-y-auto pr-0.5">
                {groupedByWorkspace.map((section) => (
                  <div key={section.workspaceId} className="space-y-1">
                    {memoryWorkspaces.length > 1 && (
                      <p className="px-1 text-label-small text-on-surface-variant">
                        {section.workspaceName}
                      </p>
                    )}
                    <div className="divide-y divide-outline-variant overflow-hidden rounded-md border border-outline-variant bg-surface-container-low">
                      {section.items.map((group) => {
                        const currentPerm = customScopes[group.slug] ?? "none";
                        return (
                          <div
                            key={group.slug}
                            className="flex items-center justify-between gap-2 px-3 py-2"
                          >
                            <div className="min-w-0">
                              <span className="truncate text-body-medium font-medium text-on-surface">
                                {group.name}
                              </span>
                              <span className="ml-1.5 font-mono text-label-small text-on-surface-variant">
                                {group.slug}
                              </span>
                            </div>

                            <div
                              role="radiogroup"
                              aria-label={`${group.name} 权限`}
                              className="inline-flex shrink-0 overflow-hidden rounded-full border border-outline-variant bg-surface-container"
                            >
                              {(
                                [
                                  {
                                    val: "none",
                                    label: "无",
                                    icon: Minus,
                                    activeClass:
                                      "bg-surface-container-highest text-on-surface font-medium",
                                  },
                                  {
                                    val: "r",
                                    label: "只读",
                                    icon: Eye,
                                    activeClass:
                                      "bg-secondary-container text-on-secondary-container font-medium",
                                  },
                                  {
                                    val: "rw",
                                    label: "读写",
                                    icon: Pencil,
                                    activeClass:
                                      "bg-primary-container text-on-primary-container font-medium",
                                  },
                                ] as const
                              ).map((opt, idx) => {
                                const Icon = opt.icon;
                                const selected = currentPerm === opt.val;
                                return (
                                  <button
                                    key={opt.val}
                                    type="button"
                                    role="radio"
                                    aria-checked={selected}
                                    onClick={() =>
                                      setCustomScopes((prev) => ({
                                        ...prev,
                                        [group.slug]: opt.val,
                                      }))
                                    }
                                    className={`md-state-layer inline-flex h-7 items-center gap-1 px-2.5 text-label-small transition-colors focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${
                                      idx > 0 ? "border-l border-outline-variant" : ""
                                    } ${
                                      selected
                                        ? opt.activeClass
                                        : "text-on-surface-variant hover:text-on-surface"
                                    }`}
                                  >
                                    <Icon className="h-3 w-3" aria-hidden />
                                    <span>{opt.label}</span>
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {failure && (
          <p role="alert" className="text-body-small text-error">
            {failure}
          </p>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="text" size="sm" type="button" onClick={onClose}>
            取消
          </Button>
          <Button
            variant="primary"
            size="sm"
            type="submit"
            disabled={invalid || busy}
            busy={busy}
            busyText={existing ? "正在保存..." : "正在签发..."}
          >
            {existing ? "保存" : "签发"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function DisclosureDialog({
  result,
  onClose,
}: {
  result: CreatedKeyResult;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const tokenRef = useRef<HTMLDivElement>(null);

  async function copyToken() {
    try {
      await navigator.clipboard.writeText(result.token);
      setCopied(true);
      setCopyFailed(false);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopyFailed(true);
      if (tokenRef.current) {
        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(tokenRef.current);
        selection?.removeAllRanges();
        selection?.addRange(range);
      }
    }
  }

  return (
    <Dialog open onClose={onClose} panelClassName="max-w-md">
      <div className="space-y-4">
        <h2 className="text-title-large text-on-surface">Key 签发成功</h2>

        <div className="flex items-start gap-2.5 rounded-md bg-warning-container p-3 text-on-warning-container">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <p className="text-body-small">
            明文令牌仅展示一次，关闭后无法找回，请立即复制保存。
          </p>
        </div>

        <div className="space-y-1.5">
          <span className="text-label-large text-on-surface">明文令牌</span>
          <div
            ref={tokenRef}
            className="select-all break-all rounded-sm border border-outline-variant bg-surface-container-highest p-3 font-mono text-body-small text-on-surface"
          >
            {result.token}
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 pt-2">
          <Button variant="tonal" size="sm" onClick={copyToken}>
            {copied ? (
              <>
                <Check className="h-3.5 w-3.5 text-success" aria-hidden />
                <span>已复制</span>
              </>
            ) : copyFailed ? (
              <>
                <Copy className="h-3.5 w-3.5 text-warning" aria-hidden />
                <span>请手动复制</span>
              </>
            ) : (
              <>
                <Copy className="h-3.5 w-3.5" aria-hidden />
                <span>复制令牌</span>
              </>
            )}
          </Button>

          <Button variant="primary" size="sm" onClick={onClose}>
            我已保存并关闭
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function RevokeKeyDialog({
  keyRecord,
  onClose,
  onRevoked,
}: {
  keyRecord: KeyRecord;
  onClose: () => void;
  onRevoked: () => Promise<void>;
}) {
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleRevoke() {
    setBusy(true);
    setFailure(null);
    try {
      await api.revokeKey(keyRecord.id);
      await onRevoked();
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "吊销失败");
      setBusy(false);
    }
  }

  return (
    <Dialog open onClose={onClose} panelClassName="max-w-sm">
      <div className="space-y-4">
        <h2 className="text-title-large text-on-surface">吊销 Key</h2>
        <p className="text-body-medium text-on-surface-variant">
          确认吊销 Key「{keyRecord.name}」({keyRecord.id}) 吗？吊销后将无法继续访问。
        </p>

        {failure && (
          <p role="alert" className="text-body-small text-error">
            {failure}
          </p>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="text" size="sm" type="button" onClick={onClose}>
            取消
          </Button>
          <Button
            variant="warning"
            size="sm"
            onClick={handleRevoke}
            disabled={busy}
            busy={busy}
            busyText="正在吊销..."
          >
            确认吊销
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function DeleteKeyDialog({
  keyRecord,
  onClose,
  onDeleted,
}: {
  keyRecord: KeyRecord;
  onClose: () => void;
  onDeleted: () => Promise<void>;
}) {
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleDelete() {
    setBusy(true);
    setFailure(null);
    try {
      await api.deleteKey(keyRecord.id);
      await onDeleted();
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "删除失败");
      setBusy(false);
    }
  }

  return (
    <Dialog open onClose={onClose} panelClassName="max-w-sm">
      <div className="space-y-4">
        <h2 className="text-title-large text-on-surface">删除 Key</h2>
        <p className="text-body-medium text-on-surface-variant">
          确认永久物理删除 Key「{keyRecord.name}」({keyRecord.id}) 吗？此操作不可逆。
        </p>

        {failure && (
          <p role="alert" className="text-body-small text-error">
            {failure}
          </p>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="text" size="sm" type="button" onClick={onClose}>
            取消
          </Button>
          <Button
            variant="danger"
            size="sm"
            onClick={handleDelete}
            disabled={busy}
            busy={busy}
            busyText="正在删除..."
          >
            确认删除
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
