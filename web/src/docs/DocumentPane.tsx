import { ArrowLeft, Pencil, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

import { api } from "../api";
import {
  Badge,
  Button,
  EmptyState,
  ErrorBanner,
  Markdown,
  Skeleton,
  Textarea,
  UnauthorizedState,
} from "../components/ui";
import type { DocCategory, DocScope, DocumentDetail } from "../types";
import { useAsync } from "../useAsync";
import { DeleteDocumentDialog, RenameDocumentDialog } from "./DocsDialogs";

/**
 * 文档阅读与在线编辑面板。编辑态由本地 draft 承载，脏状态通过 onDirtyChange
 * 上报给上层，使切换文档时的确认保护与刷新页面保护共用同一判据。
 */
export function DocumentPane({
  workspaceId,
  scope,
  category,
  documentId,
  onDirtyChange,
  onChanged,
  onDeleted,
  onBack,
}: {
  workspaceId: string;
  scope: DocScope;
  category: DocCategory | null;
  documentId: string | null;
  onDirtyChange: (dirty: boolean) => void;
  onChanged: () => Promise<void>;
  onDeleted: () => Promise<void>;
  onBack: () => void;
}) {
  const detail = useAsync(
    () => (documentId ? api.doc(workspaceId, documentId) : Promise.resolve(null)),
    [workspaceId, documentId],
  );
  const [draft, setDraft] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [renaming, setRenaming] = useState<DocumentDetail | null>(null);
  const [deleting, setDeleting] = useState<DocumentDetail | null>(null);

  const document = detail.data;
  const dirty = draft !== null && document !== null && draft !== document.content;

  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);

  useEffect(() => {
    setDraft(null);
    setFailure(null);
  }, [documentId]);

  useEffect(() => {
    if (!dirty) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  function cancel() {
    // ponytail: 未保存修改的放弃确认用原生 confirm 足够，避免为一个瞬时判断引入模态状态机。
    if (dirty && !window.confirm("当前文档有未保存的修改，确定放弃？")) return;
    setDraft(null);
  }

  async function save() {
    if (draft === null || !document) return;
    setBusy(true);
    setFailure(null);
    try {
      await api.updateDoc(workspaceId, document.id, { content: draft });
      setDraft(null);
      detail.reload();
      await onChanged();
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "保存失败");
    } finally {
      setBusy(false);
    }
  }

  if (detail.loading) return <Skeleton rows={6} />;
  if (detail.error?.code === "UNAUTHORIZED") return <UnauthorizedState />;
  if (detail.error) return <ErrorBanner message={detail.error.message} onRetry={detail.reload} />;
  if (!document) return <EmptyState message="从左侧选择一篇文档查看正文" />;

  return (
    <article className="flex min-h-0 flex-1 flex-col bg-surface">
      <header className="space-y-3 border-b border-outline-variant px-5 py-4">
        <Button variant="text" size="sm" onClick={onBack} className="!px-2 md:hidden">
          <ArrowLeft className="h-4 w-4" aria-hidden />
          <span>返回文档列表</span>
        </Button>

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1.5">
            <h1 className="truncate font-mono text-title-medium text-on-surface">{document.path}</h1>
            <div className="flex flex-wrap items-center gap-2 text-label-medium text-on-surface-variant">
              <Badge variant={scope === "public" ? "neutral" : "primary"}>
                {scope === "public" ? "公共文档" : category?.name ?? "分类文档"}
              </Badge>
              <span>{document.char_count} 字符</span>
              <span>更新 {document.updated_at.slice(0, 10)}</span>
            </div>
          </div>

          <div className="flex shrink-0 flex-wrap gap-1.5">
            {draft === null ? (
              <Button variant="tonal" size="sm" onClick={() => setDraft(document.content)}>
                <Pencil className="h-3.5 w-3.5" aria-hidden />
                <span>编辑</span>
              </Button>
            ) : (
              <>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={save}
                  disabled={!dirty}
                  busy={busy}
                  busyText="正在保存..."
                >
                  保存
                </Button>
                <Button variant="text" size="sm" onClick={cancel}>
                  取消
                </Button>
              </>
            )}
            <Button variant="secondary" size="sm" onClick={() => setRenaming(document)}>
              重命名
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setDeleting(document)}>
              <Trash2 className="h-3.5 w-3.5" aria-hidden />
              <span>删除</span>
            </Button>
          </div>
        </div>

        {failure && (
          <p role="alert" className="text-body-small text-error">
            {failure}
          </p>
        )}
      </header>

      {draft === null ? (
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          {document.content.trim() === "" ? (
            <p className="text-body-medium text-on-surface-variant">（空文档）</p>
          ) : (
            <Markdown>{document.content}</Markdown>
          )}
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          <Textarea
            aria-label="文档正文"
            value={draft}
            rows={24}
            onChange={(event) => setDraft(event.target.value)}
            className="min-h-[50vh] font-mono"
          />
        </div>
      )}

      {renaming && (
        <RenameDocumentDialog
          workspaceId={workspaceId}
          document={renaming}
          onClose={() => setRenaming(null)}
          onRenamed={() => {
            setRenaming(null);
            // 路径是详情投影的一部分，重命名后必须重取详情，否则标题仍是旧路径。
            detail.reload();
            void onChanged();
          }}
        />
      )}

      {deleting && (
        <DeleteDocumentDialog
          workspaceId={workspaceId}
          document={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={() => {
            setDeleting(null);
            void onDeleted();
          }}
        />
      )}
    </article>
  );
}
