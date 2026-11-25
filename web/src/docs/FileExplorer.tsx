import {
  BookOpenCheck,
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  FilePlus2,
  FileText,
  Folder,
  FolderOpen,
  FolderTree,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Settings2,
} from "lucide-react";

import type { ApiError } from "../api";
import {
  Button,
  EmptyState,
  ErrorBanner,
  IconButton,
  Input,
  Skeleton,
  UnauthorizedState,
} from "../components/ui";
import type { DocCategory, DocScope } from "../types";
import type { TreeNode } from "./fileTree";

function TreeRows({
  nodes,
  depth,
  expandedDirs,
  currentDir,
  selectedId,
  onSelectFolder,
  onSelectDocument,
}: {
  nodes: TreeNode[];
  depth: number;
  expandedDirs: Set<string>;
  currentDir: string;
  selectedId: string | null;
  onSelectFolder: (dirPath: string) => void;
  onSelectDocument: (documentId: string) => void;
}) {
  return (
    <ul className="space-y-0.5">
      {nodes.map((node) => {
        if (node.kind === "folder") {
          const isExpanded = expandedDirs.has(node.path);
          const isActiveDir = selectedId === null && currentDir === node.path;
          return (
            <li key={`folder:${node.path}`}>
              <button
                type="button"
                onClick={() => onSelectFolder(node.path)}
                aria-expanded={isExpanded}
                style={{ paddingLeft: `${depth * 14 + 8}px` }}
                className={
                  "md-state-layer flex w-full items-center gap-1.5 rounded-sm py-1.5 pr-2 text-left transition-colors focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary " +
                  (isActiveDir
                    ? "bg-surface-container-high font-medium text-on-surface"
                    : "text-on-surface-variant hover:text-on-surface")
                }
              >
                {isExpanded ? (
                  <ChevronDown className="h-3.5 w-3.5 shrink-0" aria-hidden />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5 shrink-0" aria-hidden />
                )}
                {isExpanded ? (
                  <FolderOpen className="h-4 w-4 shrink-0 text-primary" aria-hidden />
                ) : (
                  <Folder className="h-4 w-4 shrink-0" aria-hidden />
                )}
                <span className="min-w-0 flex-1 truncate text-body-small text-on-surface">
                  {node.name}
                </span>
                <span className="shrink-0 text-label-small text-on-surface-variant">
                  {node.fileCount}
                </span>
              </button>
              {isExpanded && node.children.length > 0 && (
                <TreeRows
                  nodes={node.children}
                  depth={depth + 1}
                  expandedDirs={expandedDirs}
                  currentDir={currentDir}
                  selectedId={selectedId}
                  onSelectFolder={onSelectFolder}
                  onSelectDocument={onSelectDocument}
                />
              )}
            </li>
          );
        }

        const isSelected = selectedId === node.doc.id;
        return (
          <li key={`file:${node.doc.id}`}>
            <button
              type="button"
              onClick={() => onSelectDocument(node.doc.id)}
              aria-current={isSelected ? "page" : undefined}
              style={{ paddingLeft: `${depth * 14 + 26}px` }}
              className={
                "md-state-layer relative flex w-full items-center gap-2 rounded-sm py-1.5 pr-2 text-left transition-colors focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary " +
                (isSelected
                  ? "bg-secondary-container font-medium text-on-secondary-container"
                  : "text-on-surface hover:bg-surface-container-low")
              }
            >
              {isSelected && (
                <span className="absolute bottom-1 left-0 top-1 w-1 rounded-r bg-primary" />
              )}
              <FileText
                className={
                  "h-4 w-4 shrink-0 " +
                  (isSelected ? "text-on-secondary-container" : "text-on-surface-variant")
                }
                aria-hidden
              />
              <span className="min-w-0 flex-1 truncate font-mono text-body-small">
                {node.name}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * 文档目录树面板：100% 视口高度专供当前容器的路径过滤与层级目录树。
 * 桌面端提供子项目栏折叠按钮；窄屏端在顶部呈现紧凑容器切换条触发左侧抽屉。
 */
export function FileExplorer({
  activeScope,
  activeCategory,
  railCollapsed,
  tree,
  expandedDirs,
  currentDir,
  selectedId,
  filter,
  docsLoading,
  docsError,
  onToggleRail,
  onOpenRailDrawer,
  onOpenAccess,
  onFilterChange,
  onCreateDocument,
  onCollapseAll,
  onSelectFolder,
  onSelectDocument,
  onRetryDocs,
}: {
  activeScope: DocScope;
  activeCategory: DocCategory | null;
  railCollapsed: boolean;
  tree: TreeNode[];
  expandedDirs: Set<string>;
  currentDir: string;
  selectedId: string | null;
  filter: string;
  docsLoading: boolean;
  docsError: ApiError | null;
  onToggleRail: () => void;
  onOpenRailDrawer: () => void;
  onOpenAccess?: () => void;
  onFilterChange: (value: string) => void;
  onCreateDocument: () => void;
  onCollapseAll: () => void;
  onSelectFolder: (dirPath: string) => void;
  onSelectDocument: (documentId: string) => void;
  onRetryDocs: () => void;
}) {
  const containerTitle = activeScope === "public" ? "公共文档" : activeCategory?.name ?? "子项目";

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-surface-container-low">
      <div className="shrink-0 space-y-2 border-b border-outline-variant bg-surface-container-low px-2.5 py-2.5">
        <div className="flex items-center justify-between gap-1.5">
          {/* 桌面端（lg+）：折叠/展开子项目栏 + 当前容器标题 */}
          <div className="hidden min-w-0 flex-1 items-center gap-1 lg:flex">
            <IconButton
              aria-label={railCollapsed ? "展开子项目栏" : "折叠子项目栏"}
              title={railCollapsed ? "展开子项目栏" : "折叠子项目栏"}
              onClick={onToggleRail}
              className="!h-8 !w-8 shrink-0"
            >
              {railCollapsed ? (
                <PanelLeftOpen className="h-4 w-4" aria-hidden />
              ) : (
                <PanelLeftClose className="h-4 w-4" aria-hidden />
              )}
            </IconButton>
            <span className="min-w-0 truncate text-title-small text-on-surface">
              {containerTitle}
            </span>
          </div>

          {/* 窄屏/移动端（< lg）：紧凑容器切换条触发左侧 SideSheet */}
          <button
            type="button"
            onClick={onOpenRailDrawer}
            aria-label="切换文档容器"
            className="md-state-layer flex min-w-0 flex-1 items-center gap-2 rounded-full bg-surface-container-high px-3 py-1.5 text-left text-on-surface transition-colors focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary lg:hidden"
          >
            {activeScope === "public" ? (
              <BookOpenCheck className="h-4 w-4 shrink-0 text-primary" aria-hidden />
            ) : (
              <FolderTree className="h-4 w-4 shrink-0 text-primary" aria-hidden />
            )}
            <span className="min-w-0 flex-1 truncate text-label-large">{containerTitle}</span>
            <ChevronDown className="h-4 w-4 shrink-0 text-on-surface-variant" aria-hidden />
          </button>

          <div className="flex shrink-0 items-center gap-0.5">
            {onOpenAccess && (
              <IconButton
                aria-label="接入与设置"
                title="接入与设置"
                onClick={onOpenAccess}
                className="!h-8 !w-8 lg:hidden"
              >
                <Settings2 className="h-4 w-4" aria-hidden />
              </IconButton>
            )}
            <IconButton
              aria-label="新建文档"
              title="新建文档"
              variant="tonal"
              onClick={onCreateDocument}
              className="!h-8 !w-8"
            >
              <FilePlus2 className="h-4 w-4" aria-hidden />
            </IconButton>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <div className="relative min-w-0 flex-1">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-on-surface-variant"
              aria-hidden
            />
            <Input
              value={filter}
              onChange={(event) => onFilterChange(event.target.value)}
              placeholder="筛选路径"
              aria-label="筛选文档"
              className="!h-8 !rounded-full !border-transparent !bg-surface-container-high pl-9 text-body-small"
            />
          </div>
          <IconButton
            aria-label="折叠全部"
            title="折叠全部"
            onClick={onCollapseAll}
            className="!h-8 !w-8 shrink-0"
          >
            <ChevronsDownUp className="h-4 w-4" aria-hidden />
          </IconButton>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {docsLoading ? (
          <Skeleton rows={5} />
        ) : docsError?.code === "UNAUTHORIZED" ? (
          <UnauthorizedState />
        ) : docsError ? (
          <ErrorBanner message={docsError.message} onRetry={onRetryDocs} />
        ) : tree.length === 0 ? (
          <EmptyState
            message={filter.trim() ? "没有匹配的文档" : "暂无文档"}
            action={
              <Button variant="primary" size="sm" onClick={onCreateDocument}>
                新建文档
              </Button>
            }
          />
        ) : (
          <TreeRows
            nodes={tree}
            depth={0}
            expandedDirs={expandedDirs}
            currentDir={currentDir}
            selectedId={selectedId}
            onSelectFolder={onSelectFolder}
            onSelectDocument={onSelectDocument}
          />
        )}
      </div>
    </div>
  );
}
