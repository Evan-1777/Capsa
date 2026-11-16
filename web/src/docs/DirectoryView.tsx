import {
  ArrowLeft,
  ChevronRight,
  CornerLeftUp,
  FileText,
  Folder,
  Plus,
  Settings2,
} from "lucide-react";

import { Badge, Button, EmptyState } from "../components/ui";
import type { DocCategory, DocScope } from "../types";
import {
  parentDir,
  splitBreadcrumbs,
  type TreeFileNode,
  type TreeFolderNode,
} from "./fileTree";

/**
 * 目录浏览视图：展示当前容器与目录面包屑、子文件夹列表与文档列表，支持钻取与当前目录新建。
 */
export function DirectoryView({
  scope,
  category,
  currentDir,
  totalDocsInContainer,
  folders,
  files,
  onNavigateDir,
  onSelectDocument,
  onCreateDocument,
  onOpenAccess,
  onBack,
}: {
  scope: DocScope;
  category: DocCategory | null;
  currentDir: string;
  totalDocsInContainer: number;
  folders: TreeFolderNode[];
  files: TreeFileNode[];
  onNavigateDir: (dirPath: string) => void;
  onSelectDocument: (documentId: string) => void;
  onCreateDocument: () => void;
  onOpenAccess?: () => void;
  onBack: () => void;
}) {
  const rootLabel = scope === "public" ? "公共文档" : category?.name ?? "子项目";
  const crumbs = splitBreadcrumbs(currentDir);
  const empty = totalDocsInContainer === 0 || (folders.length === 0 && files.length === 0);

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-surface">
      <header className="shrink-0 space-y-2.5 border-b border-outline-variant bg-surface-container-low px-5 py-3">
        <Button variant="text" size="sm" onClick={onBack} className="!px-2 md:hidden">
          <ArrowLeft className="h-4 w-4" aria-hidden />
          <span>返回文件树</span>
        </Button>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Badge variant={scope === "public" ? "neutral" : "primary"}>
              {scope === "public" ? "公共文档" : "子项目"}
            </Badge>
            <nav aria-label="目录路径" className="flex min-w-0 flex-wrap items-center gap-1">
              <button
                type="button"
                onClick={() => onNavigateDir("")}
                className={
                  "rounded-sm px-1.5 py-0.5 text-title-small transition-colors hover:bg-surface-container-high focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary " +
                  (currentDir === "" ? "font-semibold text-on-surface" : "text-on-surface-variant")
                }
              >
                {rootLabel}
              </button>
              {crumbs.map((crumb, index) => {
                const isLast = index === crumbs.length - 1;
                return (
                  <span key={crumb.path} className="flex min-w-0 items-center gap-1">
                    <ChevronRight
                      className="h-3.5 w-3.5 shrink-0 text-on-surface-variant"
                      aria-hidden
                    />
                    <button
                      type="button"
                      onClick={() => onNavigateDir(crumb.path)}
                      className={
                        "truncate rounded-sm px-1.5 py-0.5 font-mono text-title-small transition-colors hover:bg-surface-container-high focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary " +
                        (isLast ? "font-semibold text-on-surface" : "text-on-surface-variant")
                      }
                    >
                      {crumb.label}
                    </button>
                  </span>
                );
              })}
            </nav>
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-1.5">
            {scope === "category" && onOpenAccess && (
              <Button variant="tonal" size="sm" onClick={onOpenAccess}>
                <Settings2 className="h-3.5 w-3.5" aria-hidden />
                <span>接入与设置</span>
              </Button>
            )}
            <Button variant="primary" size="sm" onClick={onCreateDocument}>
              <Plus className="h-3.5 w-3.5" aria-hidden />
              <span>新建文档</span>
            </Button>
          </div>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-5xl px-5 py-5">
          {empty ? (
            <EmptyState
              message="当前目录暂无文档"
              action={
                <div className="flex flex-wrap items-center justify-center gap-2">
                  <Button variant="primary" size="sm" onClick={onCreateDocument}>
                    <Plus className="h-3.5 w-3.5" aria-hidden />
                    <span>新建文档</span>
                  </Button>
                  {scope === "category" && onOpenAccess && (
                    <Button variant="tonal" size="sm" onClick={onOpenAccess}>
                      <Settings2 className="h-3.5 w-3.5" aria-hidden />
                      <span>接入与设置</span>
                    </Button>
                  )}
                </div>
              }
            />
          ) : (
            <div className="overflow-hidden rounded-md border border-outline-variant bg-surface-container-lowest">
              <div className="flex items-center justify-between border-b border-outline-variant bg-surface-container px-4 py-2 text-label-medium text-on-surface-variant">
                <span>名称</span>
                <span>详情</span>
              </div>
              <ul className="divide-y divide-outline-variant">
                {currentDir !== "" && (
                  <li>
                    <button
                      type="button"
                      onClick={() => onNavigateDir(parentDir(currentDir))}
                      className="md-state-layer flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left transition-colors focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                    >
                      <span className="flex min-w-0 items-center gap-2.5">
                        <CornerLeftUp
                          className="h-4 w-4 shrink-0 text-on-surface-variant"
                          aria-hidden
                        />
                        <span className="font-mono text-body-medium text-on-surface">..</span>
                      </span>
                      <span className="shrink-0 text-label-small text-on-surface-variant">
                        返回上级
                      </span>
                    </button>
                  </li>
                )}

                {folders.map((folder) => (
                  <li key={`dir:${folder.path}`}>
                    <button
                      type="button"
                      onClick={() => onNavigateDir(folder.path)}
                      className="md-state-layer flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left transition-colors focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                    >
                      <span className="flex min-w-0 items-center gap-2.5">
                        <Folder className="h-4 w-4 shrink-0 text-primary" aria-hidden />
                        <span className="truncate font-medium text-body-medium text-on-surface">
                          {folder.name}
                        </span>
                      </span>
                      <span className="shrink-0 text-label-small text-on-surface-variant">
                        {folder.fileCount} 篇文档
                      </span>
                    </button>
                  </li>
                ))}

                {files.map((file) => (
                  <li key={`file:${file.doc.id}`}>
                    <button
                      type="button"
                      onClick={() => onSelectDocument(file.doc.id)}
                      className="md-state-layer flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left transition-colors focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                    >
                      <span className="flex min-w-0 items-center gap-2.5">
                        <FileText
                          className="h-4 w-4 shrink-0 text-on-surface-variant"
                          aria-hidden
                        />
                        <span className="truncate font-mono text-body-medium text-on-surface">
                          {file.name}
                        </span>
                      </span>
                      <span className="shrink-0 text-label-small text-on-surface-variant">
                        {file.doc.char_count} 字符 · {file.doc.updated_at.slice(0, 10)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
