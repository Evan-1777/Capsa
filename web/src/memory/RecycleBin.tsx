import { Clock, RotateCcw, Trash2 } from "lucide-react";
import { useState } from "react";

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
  UnauthorizedState,
} from "../components/ui";
import type { MemoryListItem } from "../types";
import { useAsync } from "../useAsync";
import { futureLocalDateTime, localDateTimeToUTCISO } from "./EditDrawer";

export function RecycleBin({ workspaceId }: { workspaceId: string }) {
  const [version, setVersion] = useState(0);
  const [failure, setFailure] = useState<string | null>(null);
  const [restoringItem, setRestoringItem] = useState<MemoryListItem | null>(null);
  const [purgingItem, setPurgingItem] = useState<MemoryListItem | null>(null);
  const [emptying, setEmptying] = useState(false);

  const list = useAsync(
    (signal) =>
      api.memories({ workspace_id: workspaceId, status: "deleted", limit: 100 }, signal),
    [workspaceId, version],
  );

  const refresh = () => setVersion((current) => current + 1);

  async function restoreDirect(id: string) {
    setFailure(null);
    try {
      await api.restore(id);
      refresh();
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "恢复失败");
    }
  }

  if (list.loading) return <Skeleton rows={4} />;
  if (list.error?.code === "UNAUTHORIZED") return <UnauthorizedState />;
  if (list.error) return <ErrorBanner message={list.error.message} onRetry={list.reload} />;

  const items = list.data?.items ?? [];

  return (
    <div className="mx-auto max-w-3xl space-y-4 px-5 py-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <h1 className="text-headline-small text-on-surface">回收站</h1>
          <Badge variant="neutral">{items.length}</Badge>
        </div>
        {items.length > 0 && (
          <Button variant="danger" size="sm" onClick={() => setEmptying(true)}>
            <Trash2 className="h-4 w-4" aria-hidden />
            <span>清空回收站</span>
          </Button>
        )}
      </div>

      {failure && (
        <p role="alert" className="text-body-small text-error">
          {failure}
        </p>
      )}

      {items.length === 0 ? (
        <EmptyState message="回收站暂无条目" />
      ) : (
        <Card
          as="ul"
          role="list"
          variant="outlined"
          className="divide-y divide-outline-variant overflow-hidden"
        >
          {items.map((item) => (
            <li key={item.id} className="flex items-start justify-between gap-3 px-4 py-3.5">
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="truncate text-title-small text-on-surface">{item.title}</p>
                  {item.is_expired && (
                    <Badge variant="warning">
                      <Clock className="h-3 w-3" aria-hidden />
                      <span>已到期</span>
                    </Badge>
                  )}
                </div>
                <p className="line-clamp-1 text-body-small text-on-surface-variant">
                  {item.summary}
                </p>
                <p className="truncate text-label-small text-on-surface-variant">
                  <span className="font-mono">{item.group_slug}</span>
                  <span> · 删除于 {item.deleted_at?.slice(0, 10)}</span>
                  {item.deleted_reason && <span> · {item.deleted_reason}</span>}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1 pt-0.5">
                <IconButton
                  variant="tonal"
                  aria-label={`恢复 ${item.title}`}
                  title="恢复"
                  onClick={() =>
                    item.is_expired ? setRestoringItem(item) : void restoreDirect(item.id)
                  }
                  className="!h-9 !w-9"
                >
                  <RotateCcw className="h-4 w-4" aria-hidden />
                </IconButton>
                <IconButton
                  aria-label={`永久删除 ${item.title}`}
                  title="永久删除"
                  onClick={() => setPurgingItem(item)}
                  className="!h-9 !w-9 text-error"
                >
                  <Trash2 className="h-4 w-4" aria-hidden />
                </IconButton>
              </div>
            </li>
          ))}
        </Card>
      )}

      {restoringItem && (
        <RestoreExpiredDialog
          item={restoringItem}
          onClose={() => setRestoringItem(null)}
          onRestored={() => {
            setRestoringItem(null);
            refresh();
          }}
        />
      )}

      {purgingItem && (
        <PurgeMemoryDialog
          item={purgingItem}
          onClose={() => setPurgingItem(null)}
          onPurged={() => {
            setPurgingItem(null);
            refresh();
          }}
        />
      )}

      {emptying && (
        <EmptyTrashDialog
          workspaceId={workspaceId}
          count={items.length}
          onClose={() => setEmptying(false)}
          onEmptied={() => {
            setEmptying(false);
            refresh();
          }}
        />
      )}
    </div>
  );
}

function RestoreExpiredDialog({
  item,
  onClose,
  onRestored,
}: {
  item: MemoryListItem;
  onClose: () => void;
  onRestored: () => void;
}) {
  const [strategy, setStrategy] = useState<"clear" | "reset">("clear");
  const [expiresLocal, setExpiresLocal] = useState(() => futureLocalDateTime(7));
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const expiresDate = expiresLocal ? new Date(expiresLocal) : null;
  const resetInvalid =
    strategy === "reset" &&
    (!expiresDate || Number.isNaN(expiresDate.getTime()) || expiresDate.getTime() <= Date.now());

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (resetInvalid) return;
    setBusy(true);
    setFailure(null);
    try {
      if (strategy === "reset") {
        const iso = localDateTimeToUTCISO(expiresLocal);
        if (!iso) {
          setFailure("请设置有效的归档时间");
          setBusy(false);
          return;
        }
        await api.restore(item.id, { expires_at: iso });
      } else {
        await api.restore(item.id);
      }
      onRestored();
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "恢复失败");
      setBusy(false);
    }
  }

  return (
    <Dialog open onClose={onClose} panelClassName="max-w-md">
      <form onSubmit={submit} className="space-y-4">
        <h2 className="text-title-large text-on-surface">恢复已到期记忆</h2>
        <p className="truncate text-body-medium text-on-surface-variant">{item.title}</p>

        <div
          role="radiogroup"
          aria-label="恢复方式"
          className="space-y-2"
        >
          <button
            type="button"
            role="radio"
            aria-checked={strategy === "clear"}
            onClick={() => setStrategy("clear")}
            className={`md-state-layer flex w-full items-center justify-between rounded-md border px-3.5 py-2.5 text-left text-body-medium transition-colors ${
              strategy === "clear"
                ? "border-primary bg-secondary-container font-medium text-on-secondary-container"
                : "border-outline-variant bg-surface-container-low text-on-surface"
            }`}
          >
            <span>清除时限并恢复为常规记忆</span>
          </button>

          <button
            type="button"
            role="radio"
            aria-checked={strategy === "reset"}
            onClick={() => setStrategy("reset")}
            className={`md-state-layer flex w-full items-center justify-between rounded-md border px-3.5 py-2.5 text-left text-body-medium transition-colors ${
              strategy === "reset"
                ? "border-primary bg-secondary-container font-medium text-on-secondary-container"
                : "border-outline-variant bg-surface-container-low text-on-surface"
            }`}
          >
            <span>重设归档时限并恢复</span>
          </button>
        </div>

        {strategy === "reset" && (
          <div className="space-y-2 rounded-md border border-outline-variant bg-surface-container p-3">
            <FormField label="新归档时间" id="restore-expires-at">
              <Input
                id="restore-expires-at"
                type="datetime-local"
                aria-label="新归档时间"
                value={expiresLocal}
                invalid={resetInvalid}
                onChange={(event) => setExpiresLocal(event.target.value)}
              />
            </FormField>
            <div className="flex flex-wrap gap-1.5">
              {[
                { label: "+1天", days: 1 },
                { label: "+7天", days: 7 },
                { label: "+30天", days: 30 },
              ].map((preset) => (
                <button
                  key={preset.days}
                  type="button"
                  onClick={() => setExpiresLocal(futureLocalDateTime(preset.days))}
                  className="md-state-layer rounded-sm border border-outline-variant bg-surface-container-low px-2.5 py-1 text-label-medium text-on-surface-variant hover:border-outline hover:text-on-surface"
                >
                  {preset.label}
                </button>
              ))}
            </div>
            {resetInvalid && (
              <p role="alert" className="text-body-small text-error">
                归档时间必须晚于当前时间
              </p>
            )}
          </div>
        )}

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
            variant="primary"
            size="sm"
            type="submit"
            disabled={resetInvalid || busy}
            busy={busy}
            busyText="正在恢复..."
          >
            确认恢复
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function PurgeMemoryDialog({
  item,
  onClose,
  onPurged,
}: {
  item: MemoryListItem;
  onClose: () => void;
  onPurged: () => void;
}) {
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handlePurge() {
    setBusy(true);
    setFailure(null);
    try {
      await api.purgeMemory(item.id);
      onPurged();
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "永久删除失败");
      setBusy(false);
    }
  }

  return (
    <Dialog open onClose={onClose} panelClassName="max-w-sm">
      <div className="space-y-4">
        <h2 className="text-title-large text-on-surface">永久删除记忆</h2>
        <p className="text-body-medium text-on-surface-variant">
          确认永久删除「{item.title}」吗？此操作不可恢复。
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
            type="button"
            onClick={handlePurge}
            disabled={busy}
            busy={busy}
            busyText="正在删除..."
          >
            永久删除
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function EmptyTrashDialog({
  workspaceId,
  count,
  onClose,
  onEmptied,
}: {
  workspaceId: string;
  count: number;
  onClose: () => void;
  onEmptied: () => void;
}) {
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleEmpty() {
    setBusy(true);
    setFailure(null);
    try {
      await api.emptyTrash({ workspace_id: workspaceId });
      onEmptied();
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "清空失败");
      setBusy(false);
    }
  }

  return (
    <Dialog open onClose={onClose} panelClassName="max-w-sm">
      <div className="space-y-4">
        <h2 className="text-title-large text-on-surface">清空回收站</h2>
        <p className="text-body-medium text-on-surface-variant">
          确认永久删除当前工作区回收站中的全部 {count} 条记忆吗？此操作不可恢复。
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
            type="button"
            onClick={handleEmpty}
            disabled={busy}
            busy={busy}
            busyText="正在清空..."
          >
            确认清空
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
