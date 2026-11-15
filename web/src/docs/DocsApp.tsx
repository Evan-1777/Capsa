import { ArrowLeft, BookOpenCheck, FileText, FolderTree, Plus, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ApiError, api } from "../api";
import {
  Badge,
  Button,
  EmptyState,
  ErrorBanner,
  Input,
  Skeleton,
  UnauthorizedState,
} from "../components/ui";
import { AppShell, type WorkspaceShellProps } from "../shell";
import type { DocCategory, DocScope, DocumentSummary, KeyInfo, WorkspaceInfo } from "../types";
import { CategoryAccessBar } from "./CategoryAccessBar";
import { DocumentPane } from "./DocumentPane";
import {
  CategoryDialog,
  DeleteCategoryDialog,
  DocumentDialog,
  type CategoryEditing,
} from "./DocsDialogs";

type Container = { scope: DocScope; categoryId: string | null };
type MobilePane = "nav" | "list" | "doc";

/**
 * 文档工作区子应用：公共区与分类导航、分类访问 ID 管理、文档浏览与在线编辑。
 * 与记忆子应用平行复用同一全局外壳，传统五视图在此完全不出现。
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
  const [pane, setPane] = useState<MobilePane>("nav");
  const [categoryEditing, setCategoryEditing] = useState<CategoryEditing | null>(null);
  const [deletingCategory, setDeletingCategory] = useState<DocCategory | null>(null);
  const [creatingDocument, setCreatingDocument] = useState(false);
  const dirtyRef = useRef(false);

  const activeCategory = useMemo(
    () => categories.find((item) => item.id === container.categoryId) ?? null,
    [categories, container.categoryId],
  );

  const reloadCategories = useCallback(async () => {
    const listed = await api.docCategories(workspace.id);
    setCategories(listed.items);
    setCategoriesError(null);
    const publicDocs = await api.docs(workspace.id, { scope: "public" });
    setPublicCount(publicDocs.total);
  }, [workspace.id]);

  const loadCategories = useCallback(async () => {
    setCategoriesLoading(true);
    try {
      await reloadCategories();
    } catch (error) {
      if (!(error instanceof ApiError && error.code === "UNAUTHORIZED")) {
        setCategoriesError(error instanceof Error ? error.message : "分类列表加载失败");
      }
    } finally {
      setCategoriesLoading(false);
    }
  }, [reloadCategories]);

  useEffect(() => {
    void loadCategories();
  }, [loadCategories]);

  const loadDocs = useCallback(async () => {
    setDocsLoading(true);
    try {
      const listed = await api.docs(workspace.id, {
        scope: container.scope,
        category_id: container.categoryId ?? undefined,
      });
      setDocuments(listed.items);
      setDocsError(null);
    } catch (error) {
      setDocsError(
        error instanceof ApiError ? error : new ApiError("INTERNAL_ERROR", "文档列表加载失败", 0),
      );
    } finally {
      setDocsLoading(false);
    }
  }, [workspace.id, container.scope, container.categoryId]);

  useEffect(() => {
    void loadDocs();
  }, [loadDocs]);

  const visibleDocuments = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return documents;
    return documents.filter((item) => item.path.toLowerCase().includes(needle));
  }, [documents, filter]);

  const afterMutation = useCallback(async () => {
    await reloadCategories();
    await loadDocs();
  }, [reloadCategories, loadDocs]);

  // ponytail: 脏状态用 ref 承载，切换判据只在事件回调里读一次，避免为一个瞬时判断引入额外渲染。
  const handleDirtyChange = useCallback((value: boolean) => {
    dirtyRef.current = value;
  }, []);

  const guardDirty = useCallback(() => {
    if (!dirtyRef.current) return true;
    if (window.confirm("当前文档有未保存的修改，确定放弃？")) {
      dirtyRef.current = false;
      return true;
    }
    return false;
  }, []);

  function selectContainer(next: Container) {
    if (!guardDirty()) return;
    setContainer(next);
    setSelectedId(null);
    setFilter("");
    setPane("list");
  }

  function selectDocument(id: string) {
    if (!guardDirty()) return;
    setSelectedId(id);
    setPane("doc");
  }

  async function handleDocumentDeleted() {
    setSelectedId(null);
    setPane("list");
    await afterMutation();
  }

  const containerButton = (active: boolean) =>
    "md-state-layer flex w-full items-center justify-between gap-2 rounded-full px-3 py-2 text-left transition-colors focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary " +
    (active ? "bg-secondary-container text-on-secondary-container" : "text-on-surface-variant");

  return (
    <AppShell
      info={info}
      theme={theme}
      onToggleTheme={onToggleTheme}
      onSignOut={onSignOut}
      currentTitle="文档工作区"
      {...shell}
    >
      {categoriesLoading ? (
        <Skeleton rows={3} />
      ) : categoriesError ? (
        <ErrorBanner message={categoriesError} onRetry={loadCategories} />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-surface">
          {activeCategory && (
            <div className={(pane === "nav" ? "hidden md:block " : "") + "shrink-0"}>
              <CategoryAccessBar
                workspaceId={workspace.id}
                category={activeCategory}
                onRotated={(updated) => {
                  setCategories((current) =>
                    current.map((item) => (item.id === updated.id ? updated : item)),
                  );
                }}
                onRename={() => setCategoryEditing({ mode: "edit", category: activeCategory })}
                onDelete={() => setDeletingCategory(activeCategory)}
              />
            </div>
          )}

          <div className="flex min-h-0 flex-1 flex-col overflow-hidden md:flex-row">
            <aside
              aria-label="文档容器"
              className={
                (pane === "nav" ? "flex" : "hidden") +
                " min-h-0 w-full flex-col overflow-y-auto border-outline-variant md:flex md:w-60 md:shrink-0 md:border-r"
              }
            >
              <div className="space-y-1 p-3">
                <button
                  type="button"
                  onClick={() => selectContainer({ scope: "public", categoryId: null })}
                  aria-current={container.scope === "public"}
                  className={containerButton(container.scope === "public")}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <BookOpenCheck className="h-4 w-4 shrink-0" aria-hidden />
                    <span className="truncate text-label-large">工作区公共文档</span>
                  </span>
                  <Badge variant="neutral">{publicCount}</Badge>
                </button>
                <p className="px-3 text-body-small text-on-surface-variant">
                  跨分类只读共享，仅可在管理台维护
                </p>
              </div>

              <div className="flex items-center justify-between gap-2 px-3 pb-1">
                <span className="text-label-medium text-on-surface-variant">分类</span>
                <Button
                  variant="text"
                  size="sm"
                  onClick={() => setCategoryEditing({ mode: "create" })}
                  className="!px-2"
                >
                  <Plus className="h-3.5 w-3.5" aria-hidden />
                  <span>新建分类</span>
                </Button>
              </div>

              {categories.length === 0 ? (
                <p className="px-3 py-2 text-body-small text-on-surface-variant">
                  暂无分类，创建后即可在其中维护文档
                </p>
              ) : (
                <ul className="space-y-1 p-2">
                  {categories.map((item) => (
                    <li key={item.id}>
                      <button
                        type="button"
                        onClick={() => selectContainer({ scope: "category", categoryId: item.id })}
                        aria-current={container.categoryId === item.id}
                        className={containerButton(container.categoryId === item.id)}
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          <FolderTree className="h-4 w-4 shrink-0" aria-hidden />
                          <span className="truncate text-label-large">{item.name}</span>
                        </span>
                        <Badge variant="neutral">{item.doc_count}</Badge>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </aside>

            <section
              aria-label="文档列表"
              className={
                (pane === "list" ? "flex" : "hidden") +
                " min-h-0 w-full flex-col border-outline-variant md:flex md:w-72 md:shrink-0 md:border-r"
              }
            >
              <div className="space-y-2.5 border-b border-outline-variant bg-surface-container px-4 py-3">
                <Button
                  variant="text"
                  size="sm"
                  onClick={() => setPane("nav")}
                  className="!px-2 md:hidden"
                >
                  <ArrowLeft className="h-4 w-4" aria-hidden />
                  <span>返回容器列表</span>
                </Button>
                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <Search
                      className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-on-surface-variant"
                      aria-hidden
                    />
                    <Input
                      value={filter}
                      onChange={(event) => setFilter(event.target.value)}
                      placeholder="筛选文档路径"
                      aria-label="筛选文档"
                      className="!rounded-full !border-transparent !bg-surface-container-high pl-9"
                    />
                  </div>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => setCreatingDocument(true)}
                    className="shrink-0"
                  >
                    <Plus className="h-4 w-4" aria-hidden />
                    <span>新建文档</span>
                  </Button>
                </div>
                <p className="text-label-medium text-on-surface-variant">
                  {container.scope === "public"
                    ? "工作区公共文档"
                    : activeCategory?.name ?? "分类"}
                  {" · "}
                  {visibleDocuments.length} 篇
                </p>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto">
                {docsLoading ? (
                  <Skeleton rows={5} />
                ) : docsError?.code === "UNAUTHORIZED" ? (
                  <UnauthorizedState />
                ) : docsError ? (
                  <ErrorBanner message={docsError.message} onRetry={loadDocs} />
                ) : visibleDocuments.length === 0 ? (
                  <EmptyState
                    message={filter.trim() ? "没有匹配的文档" : "该容器下暂无文档"}
                    action={
                      <Button variant="primary" size="sm" onClick={() => setCreatingDocument(true)}>
                        新建文档
                      </Button>
                    }
                  />
                ) : (
                  <ul>
                    {visibleDocuments.map((item) => (
                      <li key={item.id}>
                        <button
                          type="button"
                          onClick={() => selectDocument(item.id)}
                          aria-current={selectedId === item.id}
                          className={
                            "md-state-layer relative flex w-full flex-col gap-1 border-b border-outline-variant px-4 py-3 text-left transition-colors focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary " +
                            (selectedId === item.id ? "bg-secondary-container" : "")
                          }
                        >
                          {selectedId === item.id && (
                            <span className="absolute bottom-0 left-0 top-0 w-1 bg-primary" />
                          )}
                          <span className="flex min-w-0 items-center gap-2">
                            <FileText
                              className="h-4 w-4 shrink-0 text-on-surface-variant"
                              aria-hidden
                            />
                            <span className="truncate font-mono text-body-medium text-on-surface">
                              {item.path}
                            </span>
                          </span>
                          <span className="text-label-small text-on-surface-variant">
                            {item.updated_at.slice(0, 10)} · {item.char_count} 字符
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>

            <section
              aria-label="文档详情"
              className={
                (pane === "doc" ? "flex" : "hidden") + " min-h-0 flex-1 flex-col md:flex"
              }
            >
              <DocumentPane
                workspaceId={workspace.id}
                scope={container.scope}
                category={activeCategory}
                documentId={selectedId}
                onDirtyChange={handleDirtyChange}
                onChanged={afterMutation}
                onDeleted={handleDocumentDeleted}
                onBack={() => setPane("list")}
              />
            </section>
          </div>
        </div>
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
            setSelectedId(null);
            if (wasActive) {
              setContainer({ scope: "public", categoryId: null });
              setPane("list");
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
          onClose={() => setCreatingDocument(false)}
          onCreated={(created) => {
            setCreatingDocument(false);
            setSelectedId(created.id);
            setPane("doc");
            void afterMutation();
          }}
        />
      )}
    </AppShell>
  );
}
