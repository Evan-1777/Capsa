import { AlertTriangle, Check, Copy, Key, Plus, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { api } from "../api";
import type { CreatedKeyResult, GroupInfo, KeyRecord, Permission } from "../types";
import { EmptyState, ErrorBanner, Skeleton } from "./States";

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
    const parts = Object.entries(scopes).map(([slug, perm]) => `${slug}: ${perm === "rw" ? "读写" : "只读"}`);
    return parts.length > 0 ? parts.join(", ") : "无权限";
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-3xl space-y-4 px-5 py-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-sm font-semibold tracking-tight">凭据管理</h1>
            <p className="text-xs text-zinc-500">管理 Agent 访问凭据，签发分组权限 Key 与吊销废弃 Key</p>
          </div>
          <button
            type="button"
            onClick={() => setIssuing(true)}
            className="flex items-center gap-1.5 rounded bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden />
            签发 Key
          </button>
        </div>

        {failure && <ErrorBanner message={failure} onRetry={loadKeys} />}

        {loading ? (
          <Skeleton rows={3} />
        ) : keys.length === 0 ? (
          <EmptyState
            message="暂无凭据"
            action={
              <button
                type="button"
                onClick={() => setIssuing(true)}
                className="rounded bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-800"
              >
                签发 Key
              </button>
            }
          />
        ) : (
          <ul className="space-y-3">
            {keys.map((key) => {
              const isCurrent = key.id === currentKeyId;
              const isRevoked = Boolean(key.revoked_at);

              return (
                <li
                  key={key.id}
                  className="space-y-3 border border-zinc-200 bg-white p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-[13px] font-medium text-zinc-900">{key.name}</span>
                        <span className="font-mono text-[11px] text-zinc-400">{key.id}</span>
                        {isCurrent && (
                          <span className="rounded bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-700">
                            当前凭据
                          </span>
                        )}
                        {isRevoked ? (
                          <span className="rounded bg-zinc-100 px-2 py-0.5 text-[11px] text-zinc-500">
                            已吊销 ({formatTime(key.revoked_at)})
                          </span>
                        ) : (
                          <span className="rounded bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                            有效
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                      {isCurrent ? (
                        <span className="text-xs text-zinc-400">当前会话不可操作</span>
                      ) : !isRevoked ? (
                        <button
                          type="button"
                          onClick={() => setRevokingKey(key)}
                          className="flex items-center gap-1 rounded border border-amber-300 px-2.5 py-1 text-xs text-amber-700 hover:bg-amber-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
                        >
                          吊销
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setDeletingKey(key)}
                          className="flex items-center gap-1 rounded border border-zinc-300 px-2.5 py-1 text-xs text-red-600 hover:bg-red-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
                        >
                          <Trash2 className="h-3 w-3" aria-hidden />
                          删除
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-1 text-xs text-zinc-500 sm:grid-cols-2">
                    <div>
                      <span className="text-zinc-400">授权权限：</span>
                      <span className="font-medium text-zinc-700">{formatScopes(key.scopes)}</span>
                    </div>
                    <div>
                      <span className="text-zinc-400">最后调用：</span>
                      <span className="text-zinc-600">{formatTime(key.last_used_at)}</span>
                    </div>
                    <div className="text-[11px] text-zinc-400">
                      创建时间：{formatTime(key.created_at)}
                    </div>
                  </div>
                </li>
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

  // 自定义模式下空权限校验
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
    <div className="fixed inset-0 z-30 grid place-items-center p-4">
      <button
        type="button"
        aria-label="关闭签发弹窗"
        onClick={onClose}
        className="absolute inset-0 bg-zinc-900/20"
      />
      <form
        onSubmit={submit}
        className="relative w-full max-w-lg space-y-4 rounded-lg border border-zinc-200 bg-white p-5 shadow-xl max-h-[90vh] overflow-y-auto"
      >
        <h2 className="text-sm font-semibold text-zinc-900">签发新 Key</h2>

        <label className="block space-y-1.5">
          <span className="flex items-center justify-between text-xs font-medium text-zinc-600">
            <span>Key 名称</span>
            <span className={name.length > NAME_MAX ? "text-red-600" : "text-zinc-400"}>
              {name.length}/{NAME_MAX}
            </span>
          </span>
          <input
            value={name}
            aria-label="Key 名称"
            placeholder="例如：Claude Desktop, Cursor 等"
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded border border-zinc-300 px-3 py-1.5 text-[13px] focus:border-blue-500 focus:outline-none"
          />
        </label>

        <div className="space-y-2">
          <span className="block text-xs font-medium text-zinc-600">权限范围</span>
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-xs text-zinc-800 cursor-pointer">
              <input
                type="radio"
                name="perm_mode"
                checked={mode === "all_rw"}
                onChange={() => setMode("all_rw")}
                className="text-zinc-900 focus:ring-blue-500"
              />
              <span>全库读写（具备全部现有及未来分组的读写权限）</span>
            </label>

            <label className="flex items-center gap-2 text-xs text-zinc-800 cursor-pointer">
              <input
                type="radio"
                name="perm_mode"
                checked={mode === "all_r"}
                onChange={() => setMode("all_r")}
                className="text-zinc-900 focus:ring-blue-500"
              />
              <span>全库只读（具备全部现有及未来分组的只读权限）</span>
            </label>

            <label className="flex items-center gap-2 text-xs text-zinc-800 cursor-pointer">
              <input
                type="radio"
                name="perm_mode"
                checked={mode === "custom"}
                onChange={() => setMode("custom")}
                className="text-zinc-900 focus:ring-blue-500"
              />
              <span>自定义分组权限</span>
            </label>
          </div>
        </div>

        {mode === "custom" && (
          <div className="space-y-2 border-t border-zinc-100 pt-3">
            <span className="block text-xs font-medium text-zinc-600">分组权限分配</span>
            {customEmpty && (
              <p role="alert" className="text-xs text-red-600">
                请至少为一个分组授予权限
              </p>
            )}
            {groups.length === 0 ? (
              <p className="text-xs text-zinc-400">库中暂无分组</p>
            ) : (
              <div className="divide-y divide-zinc-100 rounded border border-zinc-200">
                {groups.map((group) => (
                  <div
                    key={group.slug}
                    className="flex items-center justify-between gap-3 px-3 py-2 text-xs"
                  >
                    <div>
                      <span className="font-medium text-zinc-800">{group.name}</span>
                      <span className="ml-1.5 font-mono text-[11px] text-zinc-400">{group.slug}</span>
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
                        />
                        <span className="text-zinc-500">无权限</span>
                      </label>
                      <label className="flex items-center gap-1 cursor-pointer">
                        <input
                          type="radio"
                          name={`perm_${group.slug}`}
                          checked={customScopes[group.slug] === "r"}
                          onChange={() =>
                            setCustomScopes((prev) => ({ ...prev, [group.slug]: "r" }))
                          }
                        />
                        <span className="text-zinc-700">只读</span>
                      </label>
                      <label className="flex items-center gap-1 cursor-pointer">
                        <input
                          type="radio"
                          name={`perm_${group.slug}`}
                          checked={customScopes[group.slug] === "rw"}
                          onChange={() =>
                            setCustomScopes((prev) => ({ ...prev, [group.slug]: "rw" }))
                          }
                        />
                        <span className="text-zinc-700">读写</span>
                      </label>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {failure && (
          <p role="alert" className="text-xs text-red-600">
            {failure}
          </p>
        )}

        <div className="flex justify-end gap-2 pt-2">
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
            {busy ? "正在签发..." : "签发"}
          </button>
        </div>
      </form>
    </div>
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
    <div className="fixed inset-0 z-30 grid place-items-center p-4">
      <button
        type="button"
        aria-label="关闭提示弹窗"
        onClick={onClose}
        className="absolute inset-0 bg-zinc-900/20"
      />
      <div className="relative w-full max-w-md space-y-4 rounded-lg border border-zinc-200 bg-white p-5 shadow-xl">
        <h2 className="text-sm font-semibold text-zinc-900">Key 签发成功</h2>

        <div className="flex items-start gap-2 rounded border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 mt-0.5" aria-hidden />
          <p className="leading-5">
            明文令牌仅在本次创建后展示一次，服务端仅保存哈希，关闭后无法找回，请立即复制保存。
          </p>
        </div>

        <div className="space-y-1.5">
          <span className="text-xs font-medium text-zinc-600">明文令牌 (Token)</span>
          <div className="relative">
            <div
              ref={tokenRef}
              className="rounded border border-zinc-200 bg-zinc-100 p-3 font-mono text-xs text-zinc-800 break-all select-all"
            >
              {result.token}
            </div>
          </div>
        </div>

        <div className="flex justify-between items-center gap-2 pt-2">
          <button
            type="button"
            onClick={copyToken}
            className="flex items-center gap-1.5 rounded border border-zinc-300 px-3 py-1.5 text-xs text-zinc-700 hover:bg-zinc-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            {copied ? (
              <>
                <Check className="h-3.5 w-3.5 text-emerald-600" aria-hidden />
                已复制
              </>
            ) : copyFailed ? (
              <>
                <Copy className="h-3.5 w-3.5 text-amber-600" aria-hidden />
                请手动复制
              </>
            ) : (
              <>
                <Copy className="h-3.5 w-3.5 text-zinc-500" aria-hidden />
                复制令牌
              </>
            )}
          </button>

          <button
            type="button"
            onClick={onClose}
            className="rounded bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            我已保存并关闭
          </button>
        </div>
      </div>
    </div>
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
    <div className="fixed inset-0 z-30 grid place-items-center p-4">
      <button
        type="button"
        aria-label="关闭确认弹窗"
        onClick={onClose}
        className="absolute inset-0 bg-zinc-900/20"
      />
      <div className="relative w-full max-w-sm space-y-4 rounded-lg border border-zinc-200 bg-white p-5 shadow-xl">
        <h2 className="text-sm font-semibold text-zinc-900">吊销 Key</h2>
        <p className="text-xs leading-5 text-zinc-600">
          确认吊销 Key「{keyRecord.name}」({keyRecord.id}) 吗？吊销后使用该 Key 的 Agent 将无法继续访问。
        </p>

        {failure && (
          <p role="alert" className="text-xs text-red-600">
            {failure}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded border border-zinc-300 px-3 py-1.5 text-xs text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
          >
            取消
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={handleRevoke}
            className="rounded bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
          >
            {busy ? "正在吊销..." : "确认吊销"}
          </button>
        </div>
      </div>
    </div>
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
    <div className="fixed inset-0 z-30 grid place-items-center p-4">
      <button
        type="button"
        aria-label="关闭确认弹窗"
        onClick={onClose}
        className="absolute inset-0 bg-zinc-900/20"
      />
      <div className="relative w-full max-w-sm space-y-4 rounded-lg border border-zinc-200 bg-white p-5 shadow-xl">
        <h2 className="text-sm font-semibold text-zinc-900">删除 Key</h2>
        <p className="text-xs leading-5 text-zinc-600">
          确认永久删除 Key「{keyRecord.name}」({keyRecord.id}) 吗？此操作不可撤销。
        </p>

        {failure && (
          <p role="alert" className="text-xs text-red-600">
            {failure}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded border border-zinc-300 px-3 py-1.5 text-xs text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
          >
            取消
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={handleDelete}
            className="rounded bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
          >
            {busy ? "正在删除..." : "确认删除"}
          </button>
        </div>
      </div>
    </div>
  );
}
