import { ArrowLeft, ChevronRight, Pencil, Settings2, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

import { api } from "../api";
import {
  Badge,
  Button,
  ErrorBanner,
  Markdown,
  Skeleton,
  Textarea,
  UnauthorizedState,
} from "../components/ui";
import type { DocCategory, DocScope, DocumentDetail } from "../types";
import { useAsync } from "../useAsync";
import { DeleteDocumentDialog, RenameDocumentDialog } from "./DocsDialogs";
import { splitBreadcrumbs } from "./fileTree";

type EditMode = "edit" | "split" | "preview";

/**
 * 文档阅读与在线编辑面板：提供交互式路径面包屑、限宽扩展 Markdown 阅读、
 * 桌面分栏实时预览与快捷键保存，并通过 onDirtyChange 与 beforeunload 双重拦截未保存修改。
 */
export function DocumentPane({
  workspaceId,
  scope,
  category,
  documentId,
  onDirtyChange,
  onChanged,
  onDeleted,
  onNavigateDir,
  onOpenAccess,
  onBack,
}: {
  workspaceId: string;
  scope: DocScope;
  category: DocCategory | null;
  documentId: string;
  onDirtyChange: (dirty: boolean) => void;
  onChanged: () => Promise<void>;
  onDeleted: () => Promise<void>;
  onNavigateDir: (dirPath: string) => void;
  onOpenAccess?: () => void;
  onBack: () => void;
}) {
  const detail = useAsync(
    () => api.doc(workspaceId, documentId),
    [workspaceId, documentId],
  );
  const [draft, setDraft] = useState<string | null>(null);
  const [editMode, setEditMode] = useState<EditMode>("split");
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
    return () => onDirtyChange(false);
  }, [onDirtyChange]);

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

  function startEdit(content: string) {
    const isDesktop =
      typeof window !== "undefined" && window.matchMedia("(min-width: 768px)").matches;
    setEditMode(isDesktop ? "split" : "edit");
    setDraft(content);
  }

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

  function handleKeyDown(event: React.KeyboardEvent<HTMLElement>) {
    if (draft === null) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      if (dirty && !busy) {
        void save();
      }
    }
  }

  if (detail.error?.code === "UNAUTHORIZED") return <UnauthorizedState />;
  if (detail.error) return <ErrorBanner message={detail.error.message} onRetry={detail.reload} />;
  if (detail.loading || !document) return <Skeleton rows={6} />;

  const rootLabel = scope === "public" ? "公共文档" : category?.name ?? "子项目";
  const crumbs = splitBreadcrumbs(document.path);
  const parentCrumbs = crumbs.slice(0, -1);
  const fileName = crumbs.length > 0 ? crumbs[crumbs.length - 1].label : document.path;

  const modeTabClass = (active: boolean) =>
    "rounded-full px-3 py-1 text-label-medium transition-colors focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary " +
    (active
      ? "bg-secondary-container text-on-secondary-container font-medium"
      : "text-on-surface-variant hover:text-on-surface");

  return (
    <article
      onKeyDown={handleKeyDown}
      className="flex min-h-0 flex-1 flex-col bg-surface"
    >
      <header className="shrink-0 space-y-2.5 border-b border-outline-variant bg-surface-container-low px-5 py-3">
        <Button variant="text" size="sm" onClick={onBack} className="!px-2 md:hidden">
          <ArrowLeft className="h-4 w-4" aria-hidden />
          <span>返回文件树</span>
        </Button>

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1.5">
            <nav aria-label="文档面包屑" className="flex min-w-0 flex-wrap items-center gap-1">
              <button
                type="button"
                onClick={() => onNavigateDir("")}
                className="rounded-sm px-1.5 py-0.5 text-label-large text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
              >
                {rootLabel}
              </button>
              {parentCrumbs.map((crumb) => (
                <span key={crumb.path} className="flex min-w-0 items-center gap-1">
                  <ChevronRight
                    className="h-3.5 w-3.5 shrink-0 text-on-surface-variant"
                    aria-hidden
                  />
                  <button
                    type="button"
                    onClick={() => onNavigateDir(crumb.path)}
                    className="truncate rounded-sm px-1.5 py-0.5 font-mono text-label-large text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                  >
                    {crumb.label}
                  </button>
                </span>
              ))}
              <ChevronRight
                className="h-3.5 w-3.5 shrink-0 text-on-surface-variant"
                aria-hidden
              />
              <h1 className="truncate font-mono text-title-medium text-on-surface">{fileName}</h1>
            </nav>

            <div className="flex flex-wrap items-center gap-2 text-label-medium text-on-surface-variant">
              <Badge variant={scope === "public" ? "neutral" : "primary"}>
                {scope === "public" ? "公共文档" : category?.name ?? "子项目文档"}
              </Badge>
              <span>{document.char_count} 字符</span>
              <span>更新 {document.updated_at.slice(0, 10)}</span>
              {dirty && <Badge variant="warning">未保存修改</Badge>}
            </div>
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-1.5">
            {draft === null ? (
              <>
                <Button variant="tonal" size="sm" onClick={() => startEdit(document.content)}>
                  <Pencil className="h-3.5 w-3.5" aria-hidden />
                  <span>编辑</span>
                </Button>
                <Button variant="secondary" size="sm" onClick={() => setRenaming(document)}>
                  重命名
                </Button>
                <Button variant="secondary" size="sm" onClick={() => setDeleting(document)}>
                  <Trash2 className="h-3.5 w-3.5" aria-hidden />
                  <span>删除</span>
                </Button>
                {scope === "category" && onOpenAccess && (
                  <Button variant="secondary" size="sm" onClick={onOpenAccess}>
                    <Settings2 className="h-3.5 w-3.5" aria-hidden />
                    <span>接入与设置</span>
                  </Button>
                )}
              </>
            ) : (
              <>
                <div
                  role="group"
                  aria-label="编辑视图模式"
                  className="inline-flex items-center rounded-full border border-outline-variant bg-surface-container p-0.5"
                >
                  <button
                    type="button"
                    aria-pressed={editMode === "edit"}
                    onClick={() => setEditMode("edit")}
                    className={modeTabClass(editMode === "edit")}
                  >
                    编辑
                  </button>
                  <button
                    type="button"
                    aria-pressed={editMode === "split"}
                    onClick={() => setEditMode("split")}
                    className={"hidden md:inline-flex " + modeTabClass(editMode === "split")}
                  >
                    分栏
                  </button>
                  <button
                    type="button"
                    aria-pressed={editMode === "preview"}
                    onClick={() => setEditMode("preview")}
                    className={modeTabClass(editMode === "preview")}
                  >
                    预览
                  </button>
                </div>

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
          </div>
        </div>

        {failure && (
          <p role="alert" className="text-body-small text-error">
            {failure}
          </p>
        )}
      </header>

      {draft === null ? (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-4xl px-5 py-6 sm:px-8">
            {document.content.trim() === "" ? (
              <p className="text-body-medium text-on-surface-variant">（空文档）</p>
            ) : (
              <Markdown>{document.content}</Markdown>
            )}
          </div>
        </div>
      ) : editMode === "edit" ? (
        <div className="flex min-h-0 flex-1 flex-col p-4 sm:p-5">
          <Textarea
            aria-label="文档正文"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            className="min-h-[50vh] flex-1 resize-none font-mono leading-relaxed"
          />
        </div>
      ) : editMode === "preview" ? (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-4xl px-5 py-6 sm:px-8">
            {draft.trim() === "" ? (
              <p className="text-body-medium text-on-surface-variant">（空文档）</p>
            ) : (
              <Markdown>{draft}</Markdown>
            )}
          </div>
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-2 md:divide-x md:divide-outline-variant">
          <div className="flex min-h-0 flex-col p-4">
            <Textarea
              aria-label="文档正文"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              className="min-h-[50vh] flex-1 resize-none font-mono leading-relaxed"
            />
          </div>
          <div className="hidden min-h-0 overflow-y-auto px-5 py-5 md:block">
            {draft.trim() === "" ? (
              <p className="text-body-medium text-on-surface-variant">（空文档）</p>
            ) : (
              <Markdown>{draft}</Markdown>
            )}
          </div>
        </div>
      )}

      {renaming && (
        <RenameDocumentDialog
          workspaceId={workspaceId}
          document={renaming}
          onClose={() => setRenaming(null)}
          onRenamed={() => {
            setRenaming(null);
            // 路径是详情投影的一部分，重命名后必须重取详情，否则面包屑仍是旧路径。
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
