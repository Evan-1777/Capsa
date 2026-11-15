import { Check, Copy, Pencil, RefreshCw, Trash2 } from "lucide-react";
import { useState } from "react";

import { api } from "../api";
import { Button, Card, Dialog } from "../components/ui";
import type { DocCategory } from "../types";

/**
 * 分类访问 ID 内联管理：常驻展示访问 ID 与 MCP 接入地址，支持一键复制与轮换。
 * 访问 ID 属于可随时轮换的凭据，界面只在本地状态里持有复制反馈。
 */
export function CategoryAccessBar({
  workspaceId,
  category,
  onRotated,
  onRename,
  onDelete,
}: {
  workspaceId: string;
  category: DocCategory;
  onRotated: (category: DocCategory) => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  const [copied, setCopied] = useState<"access" | "endpoint" | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [rotating, setRotating] = useState(false);

  const endpoint = window.location.origin + "/mcp/docs";
  const endpointWithToken = endpoint + "?token=" + category.access_id;

  async function copy(value: string, kind: "access" | "endpoint") {
    try {
      if (!navigator.clipboard) throw new Error("clipboard unavailable");
      await navigator.clipboard.writeText(value);
      setFailure(null);
      setCopied(kind);
      window.setTimeout(() => setCopied(null), 2000);
    } catch {
      setFailure("浏览器拒绝写入剪贴板，请手动选择复制");
    }
  }

  async function rotate() {
    setRotating(true);
    setFailure(null);
    try {
      onRotated(await api.rotateDocCategoryToken(workspaceId, category.id));
      setConfirming(false);
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "轮换失败");
    } finally {
      setRotating(false);
    }
  }

  return (
    <Card variant="filled" className="space-y-3 border-b border-outline-variant px-5 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-0.5">
          <h2 className="truncate text-title-medium text-on-surface">{category.name}</h2>
          <p className="text-body-small text-on-surface-variant">
            {category.description || "暂无描述"} · {category.doc_count} 篇文档
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-1.5">
          <Button variant="tonal" size="sm" onClick={onRename}>
            <Pencil className="h-3.5 w-3.5" aria-hidden />
            <span>重命名分类</span>
          </Button>
          <Button variant="secondary" size="sm" onClick={onDelete}>
            <Trash2 className="h-3.5 w-3.5" aria-hidden />
            <span>删除分类</span>
          </Button>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-1.5">
          <p className="text-label-medium text-on-surface-variant">分类访问 ID</p>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-sm border border-outline-variant bg-surface-container-lowest px-2 py-1 font-mono text-body-small text-on-surface">
              {category.access_id}
            </code>
            <Button
              variant="tonal"
              size="sm"
              onClick={() => copy(category.access_id, "access")}
              className="shrink-0"
            >
              {copied === "access" ? (
                <Check className="h-3.5 w-3.5" aria-hidden />
              ) : (
                <Copy className="h-3.5 w-3.5" aria-hidden />
              )}
              <span>{copied === "access" ? "已复制" : "复制访问 ID"}</span>
            </Button>
          </div>
        </div>

        <div className="space-y-1.5">
          <p className="text-label-medium text-on-surface-variant">MCP 接入地址</p>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-sm border border-outline-variant bg-surface-container-lowest px-2 py-1 font-mono text-body-small text-on-surface">
              {endpointWithToken}
            </code>
            <Button
              variant="tonal"
              size="sm"
              onClick={() => copy(endpointWithToken, "endpoint")}
              className="shrink-0"
            >
              {copied === "endpoint" ? (
                <Check className="h-3.5 w-3.5" aria-hidden />
              ) : (
                <Copy className="h-3.5 w-3.5" aria-hidden />
              )}
              <span>{copied === "endpoint" ? "已复制" : "复制接入地址"}</span>
            </Button>
          </div>
          <p className="text-body-small text-on-surface-variant">
            基础地址：<span className="font-mono">{endpoint}</span>
          </p>
        </div>
      </div>

      {failure && (
        <p role="alert" className="text-body-small text-error">
          {failure}
        </p>
      )}

      <div className="flex justify-end">
        <Button variant="secondary" size="sm" onClick={() => setConfirming(true)}>
          <RefreshCw className="h-3.5 w-3.5" aria-hidden />
          <span>重置轮换</span>
        </Button>
      </div>

      {confirming && (
        <Dialog open onClose={() => setConfirming(false)} panelClassName="max-w-sm">
          <div className="space-y-4">
            <h2 className="text-title-large text-on-surface">重置分类访问 ID</h2>
            <p className="text-body-medium text-on-surface-variant">
              确认轮换分类「{category.name}」的访问 ID 吗？旧访问 ID 将立即失效，
              已接入的 Agent 需要更新为新的地址。
            </p>

            {failure && (
              <p role="alert" className="text-body-small text-error">
                {failure}
              </p>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <Button variant="text" size="sm" type="button" onClick={() => setConfirming(false)}>
                取消
              </Button>
              <Button
                variant="primary"
                size="sm"
                type="button"
                onClick={rotate}
                disabled={rotating}
                busy={rotating}
                busyText="正在轮换..."
              >
                确认轮换
              </Button>
            </div>
          </div>
        </Dialog>
      )}
    </Card>
  );
}
