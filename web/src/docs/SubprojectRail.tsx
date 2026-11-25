import { useRef, useState } from "react";
import { BookOpenCheck, FolderTree, GripVertical, Plus, Settings2, X } from "lucide-react";

import { Badge, Button, IconButton } from "../components/ui";
import type { DocCategory, DocScope } from "../types";

function reorderList<T>(items: T[], fromIndex: number, toIndex: number): T[] {
  if (fromIndex === toIndex || fromIndex < 0 || fromIndex >= items.length) return items;
  const next = items.slice();
  const [moved] = next.splice(fromIndex, 1);
  const clamped = Math.max(0, Math.min(toIndex, next.length));
  next.splice(clamped, 0, moved);
  return next;
}

/**
 * 文档工作区独立子项目导航栏：顶部固定公共文档入口，下方承载可拖拽排序的子项目列表。
 * 桌面端作为可折叠左栏常驻，窄屏端复用同一组件渲染于左侧 SideSheet 抽屉中。
 */
export function SubprojectRail({
  categories,
  publicCount,
  activeScope,
  activeCategoryId,
  reorderError,
  onSelectContainer,
  onCreateCategory,
  onOpenAccess,
  onReorderCategories,
  onDismissReorderError,
  onCloseDrawer,
}: {
  categories: DocCategory[];
  publicCount: number;
  activeScope: DocScope;
  activeCategoryId: string | null;
  reorderError: string | null;
  onSelectContainer: (scope: DocScope, categoryId: string | null) => void;
  onCreateCategory: () => void;
  onOpenAccess: (category: DocCategory) => void;
  onReorderCategories: (nextIds: string[]) => void;
  onDismissReorderError?: () => void;
  onCloseDrawer?: () => void;
}) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const pointerIdRef = useRef<number | null>(null);
  const dragIndexRef = useRef<number | null>(null);
  const dropIndexRef = useRef<number | null>(null);

  function computeDropIndex(clientY: number): number {
    const list = listRef.current;
    if (!list) return categories.length;
    const rows = Array.from(list.querySelectorAll<HTMLLIElement>("[data-category-row]"));
    for (let i = 0; i < rows.length; i++) {
      const rect = rows[i].getBoundingClientRect();
      if (clientY < rect.top + rect.height / 2) {
        return i;
      }
    }
    return rows.length;
  }

  function handleHandlePointerDown(index: number, event: React.PointerEvent<HTMLButtonElement>) {
    if (event.button !== 0 && event.pointerType === "mouse") return;
    if (categories.length < 2) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    pointerIdRef.current = event.pointerId;
    dragIndexRef.current = index;
    dropIndexRef.current = index;
    setDragIndex(index);
    setDropIndex(index);
  }

  function handleHandlePointerMove(event: React.PointerEvent<HTMLButtonElement>) {
    if (pointerIdRef.current !== event.pointerId || dragIndexRef.current === null) return;
    const nextDrop = computeDropIndex(event.clientY);
    dropIndexRef.current = nextDrop;
    setDropIndex(nextDrop);
  }

  function finishPointerDrag(event: React.PointerEvent<HTMLButtonElement>, commit: boolean) {
    if (pointerIdRef.current !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    const from = dragIndexRef.current;
    const rawTo = dropIndexRef.current;
    pointerIdRef.current = null;
    dragIndexRef.current = null;
    dropIndexRef.current = null;
    setDragIndex(null);
    setDropIndex(null);

    if (!commit || from === null || rawTo === null) return;
    const targetIndex = rawTo > from ? rawTo - 1 : rawTo;
    if (targetIndex === from) return;
    const reordered = reorderList(categories, from, targetIndex);
    onReorderCategories(reordered.map((item) => item.id));
  }

  function handleKeyReorder(index: number, event: React.KeyboardEvent) {
    if (!event.altKey) return;
    if (event.key === "ArrowUp" && index > 0) {
      event.preventDefault();
      const reordered = reorderList(categories, index, index - 1);
      onReorderCategories(reordered.map((item) => item.id));
    } else if (event.key === "ArrowDown" && index < categories.length - 1) {
      event.preventDefault();
      const reordered = reorderList(categories, index, index + 1);
      onReorderCategories(reordered.map((item) => item.id));
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface-container">
      {onCloseDrawer && (
        <div className="flex shrink-0 items-center justify-between border-b border-outline-variant px-3 py-2.5">
          <span className="text-title-small text-on-surface">文档容器</span>
          <IconButton
            aria-label="关闭容器抽屉"
            title="关闭"
            onClick={onCloseDrawer}
            className="!h-8 !w-8"
          >
            <X className="h-4 w-4" aria-hidden />
          </IconButton>
        </div>
      )}

      <div className="shrink-0 border-b border-outline-variant p-2.5">
        <button
          type="button"
          onClick={() => onSelectContainer("public", null)}
          aria-current={activeScope === "public" ? "page" : undefined}
          className={
            "md-state-layer flex w-full items-center justify-between gap-2 rounded-full px-3 py-2 text-left transition-colors focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary " +
            (activeScope === "public"
              ? "bg-secondary-container font-medium text-on-secondary-container"
              : "text-on-surface-variant hover:text-on-surface")
          }
        >
          <span className="flex min-w-0 items-center gap-2">
            <BookOpenCheck className="h-4 w-4 shrink-0" aria-hidden />
            <span className="truncate text-label-large">公共文档</span>
          </span>
          <Badge variant="neutral">{publicCount}</Badge>
        </button>
      </div>

      <div className="flex shrink-0 items-center justify-between gap-2 px-3 pb-1.5 pt-2.5">
        <span className="text-label-medium text-on-surface-variant">子项目</span>
        <IconButton
          aria-label="新建子项目"
          title="新建子项目"
          onClick={onCreateCategory}
          className="!h-7 !w-7"
        >
          <Plus className="h-4 w-4" aria-hidden />
        </IconButton>
      </div>

      {reorderError && (
        <div
          role="alert"
          className="mx-2.5 mb-2 flex items-center justify-between gap-2 rounded-md bg-error-container px-2.5 py-1.5 text-label-small text-on-error-container"
        >
          <span className="min-w-0 flex-1 truncate">{reorderError}</span>
          {onDismissReorderError && (
            <button
              type="button"
              onClick={onDismissReorderError}
              aria-label="关闭错误提示"
              className="shrink-0 opacity-80 hover:opacity-100"
            >
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
          )}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {categories.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-3 py-8 text-center">
            <p className="text-body-small text-on-surface-variant">暂无子项目</p>
            <Button variant="tonal" size="sm" onClick={onCreateCategory}>
              <Plus className="h-3.5 w-3.5" aria-hidden />
              <span>新建子项目</span>
            </Button>
          </div>
        ) : (
          <ul ref={listRef} className="space-y-0.5" aria-label="子项目列表">
            {categories.map((item, index) => {
              const isActive = activeScope === "category" && activeCategoryId === item.id;
              const isDragging = dragIndex === index;
              const showLineBefore =
                dragIndex !== null && dropIndex === index && dropIndex !== dragIndex && dropIndex !== dragIndex + 1;
              const showLineAfter =
                dragIndex !== null &&
                index === categories.length - 1 &&
                dropIndex === categories.length &&
                dragIndex !== categories.length - 1;

              return (
                <li
                  key={item.id}
                  data-category-row={item.id}
                  className="relative"
                  onKeyDown={(event) => handleKeyReorder(index, event)}
                >
                  {showLineBefore && (
                    <div
                      aria-hidden
                      className="pointer-events-none absolute -top-0.5 left-2 right-2 z-10 h-0.5 rounded-full bg-primary"
                    />
                  )}
                  <div
                    className={
                      "group flex items-center gap-0.5 rounded-full pr-1 transition-all " +
                      (isActive
                        ? "bg-secondary-container text-on-secondary-container"
                        : "text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface") +
                      (isDragging ? " scale-[0.98] bg-surface-container-highest opacity-60" : "")
                    }
                  >
                    <button
                      type="button"
                      aria-label={`拖拽排序 ${item.name}`}
                      title="拖拽排序（或 Alt+↑/↓）"
                      onPointerDown={(event) => handleHandlePointerDown(index, event)}
                      onPointerMove={handleHandlePointerMove}
                      onPointerUp={(event) => finishPointerDrag(event, true)}
                      onPointerCancel={(event) => finishPointerDrag(event, false)}
                      className="flex h-8 w-6 shrink-0 touch-none cursor-grab items-center justify-center rounded-l-full text-on-surface-variant/70 transition-colors hover:text-on-surface focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary active:cursor-grabbing"
                    >
                      <GripVertical className="h-3.5 w-3.5" aria-hidden />
                    </button>

                    <button
                      type="button"
                      onClick={() => onSelectContainer("category", item.id)}
                      aria-current={isActive ? "page" : undefined}
                      className="flex min-w-0 flex-1 items-center justify-between gap-1.5 py-2 pr-1 text-left focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                    >
                      <span className="flex min-w-0 items-center gap-1.5">
                        <FolderTree className="h-4 w-4 shrink-0" aria-hidden />
                        <span
                          className={
                            "truncate text-label-large " + (isActive ? "font-medium" : "")
                          }
                        >
                          {item.name}
                        </span>
                      </span>
                      <Badge variant="neutral" className="shrink-0">
                        {item.doc_count}
                      </Badge>
                    </button>

                    <IconButton
                      aria-label={`子项目设置 ${item.name}`}
                      title="子项目设置"
                      onClick={() => onOpenAccess(item)}
                      className={
                        "!h-7 !w-7 shrink-0 transition-opacity " +
                        (isActive
                          ? "opacity-100"
                          : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100")
                      }
                    >
                      <Settings2 className="h-3.5 w-3.5" aria-hidden />
                    </IconButton>
                  </div>
                  {showLineAfter && (
                    <div
                      aria-hidden
                      className="pointer-events-none absolute -bottom-0.5 left-2 right-2 z-10 h-0.5 rounded-full bg-primary"
                    />
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
