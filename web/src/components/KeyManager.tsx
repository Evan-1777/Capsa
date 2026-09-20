import { AlertTriangle, Check, Copy, Plus, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { api } from "../api";
import type { CreatedKeyResult, GroupInfo, KeyRecord, Permission } from "../types";
import {
  Badge,
  Button,
  Card,
  Dialog,
  EmptyState,
  ErrorBanner,
  FormField,
  Input,
  Skeleton,
} from "./ui";

const NAME_MAX = 60;

export function KeyManager({
  groups,
  currentKeyId,
}: {
  groups: GroupInfo[];
  currentKeyId: string;
}) {
  const [keys, setKeys] = useState<KeyRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<string | null>(null);

  const [issuing, setIssuing] = useState(false);
  const [disclosureResult, setDisclosureResult] = useState<CreatedKeyResult | null>(null);
  const [revokingKey, setRevokingKey] = useState<KeyRecord | null>(null);
  const [deletingKey, setDeletingKey] = useState<KeyRecord | null>(null);

  async function loadKeys() {
    try {
      setFailure(null);
      const res = await api.keys();
      setKeys(res.items);
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "凭据列表加载失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadKeys();
  }, []);

  function formatTime(iso: string | null): string {
    if (!iso) return "从未调用";
    try {
      const d = new Date(iso);
      return isNaN(d.getTime()) ? iso : d.toLocaleString();
    } catch {
      return iso;
    }
  }

  function formatScopes(scopes: Record<string, Permission>): string {
    if (scopes["*"] === "rw") return "全库读写";
    if (scopes["*"] === "r") return "全库只读";
    const parts = Object.entries(scopes).map(
      ([slug, perm]) => `${slug}: ${perm === "rw" ? "读写" : "只读"}`,
    );
    return parts.length > 0 ? parts.join(", ") : "无权限";
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-background">
      <div className="mx-auto max-w-3xl space-y-4 px-5 py-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-sm font-semibold tracking-tight text-foreground">凭据管理</h1>
            <p className="text-xs text-muted">
              管理 Agent 访问凭据，签发分组权限 Key 与吊销废弃 Key
            </p>
          </div>
          <Button
            variant="primary"
            size="sm"
            onClick={() => setIssuing(true)}
            className="gap-1.5"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden />
            <span>签发 Key</span>
          </Button>
        </div>

        {failure && <ErrorBanner message={failure} onRetry={loadKeys} />}

        {loading ? (
          <Skeleton rows={3} />
        ) : keys.length === 0 ? (
          <EmptyState
            message="暂无凭据"
            action={
              <Button
                variant="primary"
                size="sm"
                onClick={() => setIssuing(true)}
              >
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
                <Card
                  as="li"
                  key={key.id}
                  className="space-y-3 p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-body font-semibold text-foreground">
                          {key.name}
                        </span>
                        <span className="font-mono text-caption text-muted">{key.id}</span>
                        {isCurrent && <Badge variant="brand">当前凭据</Badge>}
                        {isRevoked ? (
                          <Badge variant="neutral">已吊销 ({formatTime(key.revoked_at)})</Badge>
                        ) : (
                          <Badge variant="success">有效</Badge>
                        )}
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                      {isCurrent ? (
                        <span className="text-xs text-muted">当前会话不可操作</span>
                      ) : !isRevoked ? (
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => setRevokingKey(key)}
                          className="border-warning/30 text-warning hover:bg-warning/10"
                        >
                          吊销
                        </Button>
                      ) : (
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => setDeletingKey(key)}
                          className="gap-1 border-danger/30 text-danger hover:bg-danger/10"
                        >
                          <Trash2 className="h-3 w-3" aria-hidden />
                          <span>删除</span>
                        </Button>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-1.5 text-xs text-muted sm:grid-cols-2">
                    <div>
                      <span className="text-subtle">授权权限：</span>
                      <span className="font-medium text-foreground">{formatScopes(key.scopes)}</span>
                    </div>
                    <div>
                      <span className="text-subtle">最后调用：</span>
                      <span className="text-foreground">{formatTime(key.last_used_at)}</span>
                    </div>
                    <div className="text-caption text-subtle">
                      创建时间：{formatTime(key.created_at)}
                    </div>
                  </div>
                </Card>
              );
            })}
          </ul>
        )}
      </div>

      {issuing && (
        <IssueKeyDialog
          groups={groups}
          onClose={() => setIssuing(false)}
          onCreated={(result) => {
            setIssuing(false);
            setDisclosureResult(result);
            loadKeys();
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
            await loadKeys();
            setRevokingKey(null);
          }}
        />
      )}

      {deletingKey && (
        <DeleteKeyDialog
          keyRecord={deletingKey}
          onClose={() => setDeletingKey(null)}
          onDeleted={async () => {
            await loadKeys();
            setDeletingKey(null);
          }}
        />
      )}
    </div>
  );
}

function IssueKeyDialog({
  groups,
  onClose,
  onCreated,
}: {
  groups: GroupInfo[];
  onClose: () => void;
  onCreated: (result: CreatedKeyResult) => void;
}) {
  const [name, setName] = useState("");
  const [mode, setMode] = useState<"all_rw" | "all_r" | "custom">("all_rw");
  const [customScopes, setCustomScopes] = useState<Record<string, "none" | "r" | "rw">>(() => {
    const initial: Record<string, "none" | "r" | "rw"> = {};
    for (const g of groups) {
      initial[g.slug] = "none";
    }
    return initial;
  });
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const nameInvalid = !name.trim() || name.length > NAME_MAX;

  let customEmpty = false;
  if (mode === "custom") {
    const activeCount = Object.values(customScopes).filter((v) => v !== "none").length;
    customEmpty = activeCount === 0;
  }

  const invalid = nameInvalid || customEmpty;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (invalid) return;

    let scopes: Record<string, Permission>;
    if (mode === "all_rw") {
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
      const result = await api.createKey({ name: name.trim(), scopes });
      onCreated(result);
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "签发失败");
      setBusy(false);
    }
  }

  return (
    <Dialog open={true} onClose={onClose} panelClassName="max-w-lg max-h-[90vh] overflow-y-auto">
      <form onSubmit={submit} className="space-y-4">
        <h2 className="text-sm font-semibold text-foreground">签发新 Key</h2>

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
            placeholder="例如：Claude Desktop, Cursor 等"
            invalid={name.length > NAME_MAX}
            onChange={(e) => setName(e.target.value)}
          />
        </FormField>

        <div className="space-y-2">
          <span className="block text-xs font-medium text-foreground">权限范围</span>
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-xs text-foreground cursor-pointer">
              <input
                type="radio"
                name="perm_mode"
                checked={mode === "all_rw"}
                onChange={() => setMode("all_rw")}
                className="accent-brand"
              />
              <span>全库读写（具备全部现有及未来分组的读写权限）</span>
            </label>

            <label className="flex items-center gap-2 text-xs text-foreground cursor-pointer">
              <input
                type="radio"
                name="perm_mode"
                checked={mode === "all_r"}
                onChange={() => setMode("all_r")}
                className="accent-brand"
              />
              <span>全库只读（具备全部现有及未来分组的只读权限）</span>
            </label>

            <label className="flex items-center gap-2 text-xs text-foreground cursor-pointer">
              <input
                type="radio"
                name="perm_mode"
                checked={mode === "custom"}
                onChange={() => setMode("custom")}
                className="accent-brand"
              />
              <span>自定义分组权限</span>
            </label>
          </div>
        </div>

        {mode === "custom" && (
          <div className="space-y-2 border-t border-stroke pt-3">
            <span className="block text-xs font-medium text-foreground">分组权限分配</span>
            {customEmpty && (
              <p role="alert" className="text-xs text-danger">
                请至少为一个分组授予权限
              </p>
            )}
            {groups.length === 0 ? (
              <p className="text-xs text-muted">库中暂无分组</p>
            ) : (
              <div className="divide-y divide-stroke rounded border border-stroke">
                {groups.map((group) => (
                  <div
                    key={group.slug}
                    className="flex items-center justify-between gap-3 px-3 py-2 text-xs"
                  >
                    <div>
                      <span className="font-medium text-foreground">{group.name}</span>
                      <span className="ml-1.5 font-mono text-caption text-muted">{group.slug}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <label className="flex items-center gap-1 cursor-pointer">
                        <input
                          type="radio"
                          name={`perm_${group.slug}`}
                          checked={customScopes[group.slug] === "none"}
                          onChange={() =>
                            setCustomScopes((prev) => ({ ...prev, [group.slug]: "none" }))
                          }
                          className="accent-brand"
                        />
                        <span className="text-muted">无权限</span>
                      </label>
                      <label className="flex items-center gap-1 cursor-pointer">
                        <input
                          type="radio"
                          name={`perm_${group.slug}`}
                          checked={customScopes[group.slug] === "r"}
                          onChange={() =>
                            setCustomScopes((prev) => ({ ...prev, [group.slug]: "r" }))
                          }
                          className="accent-brand"
                        />
                        <span className="text-foreground">只读</span>
                      </label>
                      <label className="flex items-center gap-1 cursor-pointer">
                        <input
                          type="radio"
                          name={`perm_${group.slug}`}
                          checked={customScopes[group.slug] === "rw"}
                          onChange={() =>
                            setCustomScopes((prev) => ({ ...prev, [group.slug]: "rw" }))
                          }
                          className="accent-brand"
                        />
                        <span className="text-foreground">读写</span>
                      </label>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {failure && (
          <p role="alert" className="text-xs text-danger">
            {failure}
          </p>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" size="sm" type="button" onClick={onClose}>
            取消
          </Button>
          <Button
            variant="primary"
            size="sm"
            type="submit"
            disabled={invalid || busy}
            busy={busy}
            busyText="正在签发..."
          >
            签发
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
    <Dialog open={true} onClose={onClose} panelClassName="max-w-md">
      <div className="space-y-4">
        <h2 className="text-sm font-semibold text-foreground">Key 签发成功</h2>

        <div className="flex items-start gap-2.5 rounded border border-warning/30 bg-warning/10 p-3 text-xs text-warning">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden />
          <p className="leading-5">
            明文令牌仅在本次创建后展示一次，服务端仅保存哈希，关闭后无法找回，请立即复制保存。
          </p>
        </div>

        <div className="space-y-1.5">
          <span className="text-xs font-medium text-foreground">明文令牌 (Token)</span>
          <div
            ref={tokenRef}
            className="rounded border border-stroke bg-background p-3 font-mono text-xs text-foreground break-all select-all"
          >
            {result.token}
          </div>
        </div>

        <div className="flex justify-between items-center gap-2 pt-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={copyToken}
            className="gap-1.5"
          >
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
                <Copy className="h-3.5 w-3.5 text-muted" aria-hidden />
                <span>复制令牌</span>
              </>
            )}
          </Button>

          <Button
            variant="primary"
            size="sm"
            onClick={onClose}
          >
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
    <Dialog open={true} onClose={onClose} panelClassName="max-w-sm">
      <div className="space-y-4">
        <h2 className="text-sm font-semibold text-foreground">吊销 Key</h2>
        <p className="text-xs leading-5 text-muted">
          确认吊销 Key「{keyRecord.name}」({keyRecord.id}) 吗？吊销后使用该 Key 的 Agent 将无法继续访问。
        </p>

        {failure && (
          <p role="alert" className="text-xs text-danger">
            {failure}
          </p>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" size="sm" onClick={onClose}>
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
    <Dialog open={true} onClose={onClose} panelClassName="max-w-sm">
      <div className="space-y-4">
        <h2 className="text-sm font-semibold text-foreground">删除 Key</h2>
        <p className="text-xs leading-5 text-muted">
          确认永久物理删除 Key「{keyRecord.name}」({keyRecord.id}) 吗？此操作不可逆。
        </p>

        {failure && (
          <p role="alert" className="text-xs text-danger">
            {failure}
          </p>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" size="sm" onClick={onClose}>
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