import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ApiError, api } from "../api";
import { ErrorBanner, SideSheet, Skeleton } from "../components/ui";
import { AppShell, type WorkspaceShellProps } from "../shell";
import type { DocCategory, DocScope, DocumentSummary, KeyInfo, WorkspaceInfo } from "../types";
import { DirectoryView } from "./DirectoryView";
import {
  CategoryDialog,
  DeleteCategoryDialog,
  DocumentDialog,
  type CategoryEditing,
} from "./DocsDialogs";
import { DocumentPane } from "./DocumentPane";
import { FileExplorer } from "./FileExplorer";
import { SubprojectAccessDialog } from "./SubprojectAccessDialog";
import { SubprojectRail } from "./SubprojectRail";
import {
  ancestorDirs,
  buildFileTree,
  listDirectoryEntries,
  parentDir,
  type TreeNode,
} from "./fileTree";

type Container = { scope: DocScope; categoryId: string | null };
type MobileView = "explorer" | "canvas";

function collectFolderPaths(nodes: TreeNode[]): Set<string> {
  const paths = new Set<string>();
  const walk = (items: TreeNode[]) => {
    for (const item of items) {
      if (item.kind === "folder") {
        paths.add(item.path);
        walk(item.children);
      }
    }
  };
  walk(nodes);
  return paths;
}

/**
 * 文档工作区子应用：双栏文件浏览器架构，左侧承载公共区/子项目切换与层级目录树，
 * 右侧主画布承载目录表格浏览与沉浸式 Markdown 读写面板，低频接入配置收敛至独立模态弹层。
 */
export function DocsApp({
  info,
  theme,
  onToggleTheme,
  onSignOut,
  workspace,
  shell,
}: {
  info: KeyInfo;
  theme: "light" | "dark";
  onToggleTheme: () => void;
  onSignOut: () => void;
  workspace: WorkspaceInfo;
  shell: WorkspaceShellProps;
}) {
  const [categories, setCategories] = useState<DocCategory[]>([]);
  const [categoriesLoading, setCategoriesLoading] = useState(true);
  const [categoriesError, setCategoriesError] = useState<string | null>(null);
  const [publicCount, setPublicCount] = useState(workspace.public_doc_count);
  const [container, setContainer] = useState<Container>({ scope: "public", categoryId: null });
  const [documents, setDocuments] = useState<DocumentSummary[]>([]);
  const [docsLoading, setDocsLoading] = useState(true);
  const [docsError, setDocsError] = useState<ApiError | null>(null);
  const [filter, setFilter] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [currentDir, setCurrentDir] = useState("");
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(() => new Set());
  const [mobileView, setMobileView] = useState<MobileView>("explorer");
  const [railCollapsed, setRailCollapsed] = useState(false);
  const [railDrawerOpen, setRailDrawerOpen] = useState(false);
  const [reorderError, setReorderError] = useState<string | null>(null);

  const [categoryEditing, setCategoryEditing] = useState<CategoryEditing | null>(null);
  const [deletingCategory, setDeletingCategory] = useState<DocCategory | null>(null);
  const [accessCategoryId, setAccessCategoryId] = useState<string | null>(null);
  const [creatingDocument, setCreatingDocument] = useState(false);
  const dirtyRef = useRef(false);

  const activeCategory = useMemo(
    () => categories.find((item) => item.id === container.categoryId) ?? null,
    [categories, container.categoryId],
  );

  const accessCategory = useMemo(
    () => categories.find((item) => item.id === accessCategoryId) ?? null,
    [categories, accessCategoryId],
  );

  const catsAbortRef = useRef<AbortController | null>(null);
  const docsAbortRef = useRef<AbortController | null>(null);

  const reloadCategories = useCallback(async (signal?: AbortSignal) => {
    const listed = await api.docCategories(workspace.id, signal);
    if (signal?.aborted) return;
    setCategories(listed.items);
    setCategoriesError(null);
  }, [workspace.id]);

  const loadCategories = useCallback(async () => {
    catsAbortRef.current?.abort();
    const controller = new AbortController();
    catsAbortRef.current = controller;
    setCategoriesLoading(true);
    try {
      await reloadCategories(controller.signal);
    } catch (error) {
      if (controller.signal.aborted || catsAbortRef.current !== controller) return;
      if (error instanceof DOMException && error.name === "AbortError") return;
      if (!(error instanceof ApiError && error.code === "UNAUTHORIZED")) {
        setCategoriesError(error instanceof Error ? error.message : "子项目列表加载失败");
      }
    } finally {
      if (!controller.signal.aborted && catsAbortRef.current === controller) {
        setCategoriesLoading(false);
      }
    }
  }, [reloadCategories]);

  useEffect(() => {
    void loadCategories();
    return () => {
      catsAbortRef.current?.abort();
    };
  }, [loadCategories]);

  const loadDocs = useCallback(async () => {
    docsAbortRef.current?.abort();
    const controller = new AbortController();
    docsAbortRef.current = controller;
    setDocsLoading(true);
    try {
      const listed = await api.docs(
        workspace.id,
        {
          scope: container.scope,
          category_id: container.categoryId ?? undefined,
        },
        controller.signal,
      );
      if (controller.signal.aborted || docsAbortRef.current !== controller) return;
      setDocuments(listed.items);
      if (container.scope === "public") {
        setPublicCount(listed.total);
      }
      setDocsError(null);
    } catch (error) {
      if (controller.signal.aborted || docsAbortRef.current !== controller) return;
      if (error instanceof DOMException && error.name === "AbortError") return;
      setDocsError(
        error instanceof ApiError ? error : new ApiError("INTERNAL_ERROR", "文档列表加载失败", 0),
      );
    } finally {
      if (!controller.signal.aborted && docsAbortRef.current === controller) {
        setDocsLoading(false);
      }
    }
  }, [workspace.id, container.scope, container.categoryId]);

  useEffect(() => {
    void loadDocs();
    return () => {
      docsAbortRef.current?.abort();
    };
  }, [loadDocs]);

  const fullTree = useMemo(() => buildFileTree(documents), [documents]);

  const filteredDocuments = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return documents;
    return documents.filter((item) => item.path.toLowerCase().includes(needle));
  }, [documents, filter]);

  const explorerTree = useMemo(
    () => (filter.trim() ? buildFileTree(filteredDocuments) : fullTree),
    [filter, filteredDocuments, fullTree],
  );

  const effectiveExpandedDirs = useMemo(
    () => (filter.trim() ? collectFolderPaths(explorerTree) : expandedDirs),
    [filter, explorerTree, expandedDirs],
  );

  const { resolvedDir, dirEntries } = useMemo(() => {
    let candidate = currentDir;
    while (candidate !== "") {
      const entries = listDirectoryEntries(fullTree, candidate);
      if (entries.exists) {
        return { resolvedDir: candidate, dirEntries: entries };
      }
      candidate = parentDir(candidate);
    }
    return { resolvedDir: "", dirEntries: listDirectoryEntries(fullTree, "") };
  }, [fullTree, currentDir]);

  useEffect(() => {
    if (resolvedDir !== currentDir) {
      setCurrentDir(resolvedDir);
    }
  }, [resolvedDir, currentDir]);

  const afterMutation = useCallback(async () => {
    await Promise.all([reloadCategories(), loadDocs()]);
  }, [reloadCategories, loadDocs]);

  // ponytail: 脏状态用 ref 承载，切换判据只在事件回调里读一次，避免为一个瞬时判断引入额外渲染。
  const handleDirtyChange = useCallback((value: boolean) => {
    dirtyRef.current = value;
  }, []);

  const guardDirty = useCallback(() => {
    if (!dirtyRef.current) return true;
    return window.confirm("当前文档有未保存的修改，确定放弃？");
  }, []);

  function openCreateDocument() {
    if (guardDirty()) setCreatingDocument(true);
  }

  function expandPathAncestors(pathToReveal: string, includeSelf = false) {
    const dirs = ancestorDirs(pathToReveal);
    if (includeSelf && pathToReveal) dirs.push(pathToReveal);
    if (dirs.length === 0) return;
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      for (const dir of dirs) next.add(dir);
      return next;
    });
  }

  function selectContainer(scope: DocScope, categoryId: string | null) {
    setRailDrawerOpen(false);
    if (scope === container.scope && categoryId === container.categoryId) return;
    if (!guardDirty()) return;
    setContainer({ scope, categoryId });
    setSelectedId(null);
    setCurrentDir("");
    setExpandedDirs(new Set());
    setFilter("");
  }

  async function handleReorderCategories(nextIds: string[]) {
    const previous = categories;
    const byId = new Map(previous.map((item) => [item.id, item]));
    const optimistic = nextIds
      .map((id, idx) => {
        const found = byId.get(id);
        return found ? { ...found, sort_order: idx } : null;
      })
      .filter((item): item is DocCategory => item !== null);
    if (optimistic.length !== previous.length) return;
    setCategories(optimistic);
    setReorderError(null);
    try {
      const updated = await api.reorderDocCategories(workspace.id, nextIds);
      setCategories(updated.items);
    } catch (error) {
      setCategories(previous);
      setReorderError(error instanceof Error ? error.message : "排序保存失败");
    }
  }

  function selectFolder(dirPath: string) {
    if (!guardDirty()) return;
    const isAlreadyActive = selectedId === null && resolvedDir === dirPath;
    setSelectedId(null);
    setCurrentDir(dirPath);
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(dirPath) && isAlreadyActive) {
        next.delete(dirPath);
      } else {
        for (const ancestor of ancestorDirs(dirPath)) next.add(ancestor);
        next.add(dirPath);
      }
      return next;
    });
  }

  function navigateDir(dirPath: string) {
    if (!guardDirty()) return;
    setSelectedId(null);
    setCurrentDir(dirPath);
    expandPathAncestors(dirPath, true);
    setMobileView("canvas");
  }

  function selectDocument(id: string) {
    if (id === selectedId) {
      setMobileView("canvas");
      return;
    }
    if (!guardDirty()) return;
    const target = documents.find((item) => item.id === id);
    if (target) {
      setCurrentDir(parentDir(target.path));
      expandPathAncestors(target.path);
    }
    setSelectedId(id);
    setMobileView("canvas");
  }

  async function handleDocumentDeleted() {
    setSelectedId(null);
    await afterMutation();
  }

  const guardedShell: WorkspaceShellProps = {
    ...shell,
    onSelectWorkspace: shell.onSelectWorkspace
      ? (id) => {
          if (guardDirty()) shell.onSelectWorkspace?.(id);
        }
      : undefined,
    onOpenSettings: shell.onOpenSettings
      ? () => {
          if (guardDirty()) shell.onOpenSettings?.();
        }
      : undefined,
  };

  return (
    <AppShell
      info={info}
      theme={theme}
      onToggleTheme={onToggleTheme}
      onSignOut={() => {
        if (guardDirty()) onSignOut();
      }}
      currentTitle="文档工作区"
      {...guardedShell}
    >
      {categoriesLoading ? (
        <Skeleton rows={3} />
      ) : categoriesError ? (
        <ErrorBanner message={categoriesError} onRetry={loadCategories} />
      ) : (
        <div className="flex min-h-0 flex-1 overflow-hidden bg-surface">
          {!railCollapsed && (
            <aside
              aria-label="子项目导航"
              className="hidden min-h-0 w-60 shrink-0 flex-col border-r border-outline-variant lg:flex"
            >
              <SubprojectRail
                categories={categories}
                publicCount={publicCount}
                activeScope={container.scope}
                activeCategoryId={container.categoryId}
                reorderError={reorderError}
                onSelectContainer={selectContainer}
                onCreateCategory={() => setCategoryEditing({ mode: "create" })}
                onOpenAccess={(category) => setAccessCategoryId(category.id)}
                onReorderCategories={(ids) => void handleReorderCategories(ids)}
                onDismissReorderError={() => setReorderError(null)}
              />
            </aside>
          )}

          <aside
            aria-label="文件资源管理器"
            className={
              (mobileView === "explorer" ? "flex" : "hidden") +
              " min-h-0 w-full flex-col border-outline-variant md:flex md:w-64 md:shrink-0 md:border-r xl:w-72"
            }
          >
            <FileExplorer
              activeScope={container.scope}
              activeCategory={activeCategory}
              railCollapsed={railCollapsed}
              tree={explorerTree}
              expandedDirs={effectiveExpandedDirs}
              currentDir={resolvedDir}
              selectedId={selectedId}
              filter={filter}
              docsLoading={docsLoading}
              docsError={docsError}
              onToggleRail={() => setRailCollapsed((value) => !value)}
              onOpenRailDrawer={() => setRailDrawerOpen(true)}
              onOpenAccess={
                activeCategory ? () => setAccessCategoryId(activeCategory.id) : undefined
              }
              onFilterChange={setFilter}
              onCreateDocument={openCreateDocument}
              onCollapseAll={() => setExpandedDirs(new Set())}
              onSelectFolder={selectFolder}
              onSelectDocument={selectDocument}
              onRetryDocs={loadDocs}
            />
          </aside>

          <SideSheet
            open={railDrawerOpen}
            onClose={() => setRailDrawerOpen(false)}
            side="left"
            aria-label="切换子项目"
          >
            <div className="h-full w-72 max-w-[82vw] overflow-hidden border-r border-outline-variant bg-surface-container">
              <SubprojectRail
                categories={categories}
                publicCount={publicCount}
                activeScope={container.scope}
                activeCategoryId={container.categoryId}
                reorderError={reorderError}
                onSelectContainer={selectContainer}
                onCreateCategory={() => {
                  setRailDrawerOpen(false);
                  setCategoryEditing({ mode: "create" });
                }}
                onOpenAccess={(category) => {
                  setRailDrawerOpen(false);
                  setAccessCategoryId(category.id);
                }}
                onReorderCategories={(ids) => void handleReorderCategories(ids)}
                onDismissReorderError={() => setReorderError(null)}
                onCloseDrawer={() => setRailDrawerOpen(false)}
              />
            </div>
          </SideSheet>

          <section
            aria-label="文档主画布"
            className={
              (mobileView === "canvas" ? "flex" : "hidden") +
              " min-h-0 min-w-0 flex-1 flex-col md:flex"
            }
          >
            {selectedId ? (
              <DocumentPane
                workspaceId={workspace.id}
                scope={container.scope}
                category={activeCategory}
                documentId={selectedId}
                onDirtyChange={handleDirtyChange}
                onChanged={afterMutation}
                onDeleted={handleDocumentDeleted}
                onNavigateDir={navigateDir}
                onOpenAccess={
                  activeCategory ? () => setAccessCategoryId(activeCategory.id) : undefined
                }
                onBack={() => setMobileView("explorer")}
              />
            ) : (
              <DirectoryView
                scope={container.scope}
                category={activeCategory}
                currentDir={resolvedDir}
                folders={dirEntries.folders}
                files={dirEntries.files}
                onNavigateDir={navigateDir}
                onSelectDocument={selectDocument}
                onCreateDocument={openCreateDocument}
                onOpenAccess={
                  activeCategory ? () => setAccessCategoryId(activeCategory.id) : undefined
                }
                onBack={() => setMobileView("explorer")}
              />
            )}
          </section>
        </div>
      )}

      {accessCategory && (
        <SubprojectAccessDialog
          workspaceId={workspace.id}
          category={accessCategory}
          onClose={() => setAccessCategoryId(null)}
          onRotated={(updated) => {
            setCategories((current) =>
              current.map((item) => (item.id === updated.id ? updated : item)),
            );
          }}
          onEdit={() => setCategoryEditing({ mode: "edit", category: accessCategory })}
          onDelete={() => setDeletingCategory(accessCategory)}
        />
      )}

      {categoryEditing && (
        <CategoryDialog
          workspaceId={workspace.id}
          editing={categoryEditing}
          onClose={() => setCategoryEditing(null)}
          onSaved={async () => {
            await afterMutation();
            setCategoryEditing(null);
          }}
        />
      )}

      {deletingCategory && (
        <DeleteCategoryDialog
          workspaceId={workspace.id}
          category={deletingCategory}
          onClose={() => setDeletingCategory(null)}
          onDeleted={() => {
            const wasActive = container.categoryId === deletingCategory.id;
            setDeletingCategory(null);
            setAccessCategoryId(null);
            if (wasActive) {
              setSelectedId(null);
              setCurrentDir("");
              setExpandedDirs(new Set());
              setContainer({ scope: "public", categoryId: null });
            }
            void afterMutation();
          }}
        />
      )}

      {creatingDocument && (
        <DocumentDialog
          workspaceId={workspace.id}
          scope={container.scope}
          categoryId={container.categoryId ?? undefined}
          initialDir={resolvedDir}
          onClose={() => setCreatingDocument(false)}
          onCreated={(created) => {
            setCreatingDocument(false);
            setSelectedId(created.id);
            setCurrentDir(parentDir(created.path));
            expandPathAncestors(created.path);
            setMobileView("canvas");
            void afterMutation();
          }}
        />
      )}
    </AppShell>
  );
}
