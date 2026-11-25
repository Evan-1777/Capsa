import { ArrowLeft, Check, Pencil, Plus, Trash2 } from "lucide-react";
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
  Select,
  Textarea,
} from "../components/ui";
import type { WorkspaceInfo, WorkspaceMode } from "../types";

const NAME_MAX = 60;
const DESC_MAX = 200;
const SHALLOW_MIN = 1;
const SHALLOW_MAX = 120;

type Editing = { mode: "create" } | { mode: "edit"; workspace: WorkspaceInfo };

/** 全局工作区设置视图：新建（含模式选定）、基础信息与浅层记忆周期编辑、空工作区删除。 */
export function WorkspaceSettings({
  workspaces,
  activeWorkspaceId,
  onReload,
  onSelect,
  onBack,
}: {
  workspaces: WorkspaceInfo[];
  activeWorkspaceId?: string;
  onReload: () => Promise<void>;
  onSelect: (id: string) => void;
  onBack: () => void;
}) {
  const [editing, setEditing] = useState<Editing | null>(null);
  const [deleting, setDeleting] = useState<WorkspaceInfo | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  async function refresh() {
    try {
      await onReload();
      setFailure(null);
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "工作区列表刷新失败");
    }
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-surface">
      <div className="mx-auto max-w-3xl space-y-4 px-5 py-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <IconButton
              aria-label="返回当前工作区"
              title="返回"
              onClick={onBack}
              className="!h-9 !w-9"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden />
            </IconButton>
            <h1 className="text-headline-small text-on-surface">工作区设置</h1>
          </div>
          <Button variant="primary" size="sm" onClick={() => setEditing({ mode: "create" })}>
            <Plus className="h-4 w-4" aria-hidden />
            <span>新建工作区</span>
          </Button>
        </div>

        {failure && <ErrorBanner message={failure} onRetry={refresh} />}

        {workspaces.length === 0 ? (
          <EmptyState
            message="暂无工作区"
            action={
              <Button variant="primary" size="sm" onClick={() => setEditing({ mode: "create" })}>
                新建工作区
              </Button>
            }
          />
        ) : (
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {workspaces.map((workspace) => {
              const active = workspace.id === activeWorkspaceId;
              const isDefault = workspace.id === "default";
              return (
                <Card
                  as="li"
                  key={workspace.id}
                  className="flex flex-col justify-between space-y-3 p-4"
                >
                  <div className="min-w-0 space-y-1.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                        <p className="truncate text-title-small text-on-surface">
                          {workspace.name}
                        </p>
                        <Badge variant={workspace.mode === "docs" ? "primary" : "neutral"}>
                          {workspace.mode === "docs" ? "文档" : "记忆"}
                        </Badge>
                        {isDefault && <Badge variant="success">默认</Badge>}
                        {active && <Badge variant="primary">当前</Badge>}
                      </div>
                      <div className="flex shrink-0 items-center gap-0.5">
                        <IconButton
                          aria-label={`编辑工作区 ${workspace.name}`}
                          title="编辑"
                          onClick={() => setEditing({ mode: "edit", workspace })}
                          className="!h-8 !w-8"
                        >
                          <Pencil className="h-4 w-4" aria-hidden />
                        </IconButton>
                        {!isDefault && (
                          <IconButton
                            aria-label={`删除工作区 ${workspace.name}`}
                            title="删除"
                            onClick={() => setDeleting(workspace)}
                            className="!h-8 !w-8"
                          >
                            <Trash2 className="h-4 w-4" aria-hidden />
                          </IconButton>
                        )}
                      </div>
                    </div>
                    <p className="line-clamp-2 text-body-small text-on-surface-variant">
                      {workspace.description || "暂无描述"}
                    </p>
                    <p className="text-label-medium text-on-surface-variant">
                      {workspace.mode === "docs"
                        ? `${workspace.category_count} 个子项目 · ${workspace.public_doc_count} 篇公共文档`
                        : `${workspace.group_count} 个组别 · 浅层 ${workspace.shallow_months} 个月`}
                    </p>
                  </div>
                  <div className="flex items-center justify-end">
                    <Button
                      variant="tonal"
                      size="sm"
                      disabled={active}
                      onClick={() => onSelect(workspace.id)}
                    >
                      {active && <Check className="h-3.5 w-3.5" aria-hidden />}
                      <span>{active ? "当前工作区" : "切换"}</span>
                    </Button>
                  </div>
                </Card>
              );
            })}
          </ul>
        )}
      </div>

      {editing && (
        <WorkspaceDialog
          editing={editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            await refresh();
            setEditing(null);
          }}
        />
      )}

      {deleting && (
        <DeleteWorkspaceDialog
          workspace={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={async (deletedID) => {
            await refresh();
            setDeleting(null);
            if (deletedID === activeWorkspaceId) onSelect("default");
          }}
        />
      )}
    </div>
  );
}

function WorkspaceDialog({
  editing,
  onClose,
  onSaved,
}: {
  editing: Editing;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const existing = editing.mode === "edit" ? editing.workspace : null;
  const [name, setName] = useState(existing?.name ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>(existing?.mode ?? "memory");
  const [shallowMonthsText, setShallowMonthsText] = useState(
    String(existing?.shallow_months ?? 3),
  );
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const parsedShallow = Number(shallowMonthsText);
  const shallowInvalid =
    workspaceMode === "memory" &&
    (!shallowMonthsText.trim() ||
      !Number.isInteger(parsedShallow) ||
      parsedShallow < SHALLOW_MIN ||
      parsedShallow > SHALLOW_MAX);
  const nameInvalid = !name.trim() || name.length > NAME_MAX;
  const descInvalid = description.length > DESC_MAX;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (nameInvalid || descInvalid || shallowInvalid) return;
    setBusy(true);
    setFailure(null);
    try {
      if (existing) {
        await api.updateWorkspace(existing.id, {
          name,
          description,
          ...(workspaceMode === "memory" ? { shallow_months: parsedShallow } : {}),
        });
      } else {
        await api.createWorkspace({
          name,
          description,
          mode: workspaceMode,
          ...(workspaceMode === "memory" ? { shallow_months: parsedShallow } : {}),
        });
      }
      await onSaved();
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "保存失败");
      setBusy(false);
    }
  }

  return (
    <Dialog open onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <h2 className="text-title-large text-on-surface">
          {existing ? "编辑工作区" : "新建工作区"}
        </h2>

        <FormField
          label="工作区名称"
          id="workspace-name"
          counter={{ current: name.length, max: NAME_MAX, over: name.length > NAME_MAX }}
        >
          <Input
            id="workspace-name"
            aria-label="工作区名称"
            value={name}
            invalid={name.length > NAME_MAX}
            onChange={(event) => setName(event.target.value)}
            placeholder="例如：工程文档"
          />
        </FormField>

        <FormField
          label="工作区描述"
          id="workspace-desc"
          counter={{
            current: description.length,
            max: DESC_MAX,
            over: description.length > DESC_MAX,
          }}
        >
          <Textarea
            id="workspace-desc"
            aria-label="工作区描述"
            rows={3}
            value={description}
            invalid={description.length > DESC_MAX}
            onChange={(event) => setDescription(event.target.value)}
          />
        </FormField>

        <FormField label="工作区模式" id="workspace-mode">
          <Select
            id="workspace-mode"
            aria-label="工作区模式"
            value={workspaceMode}
            disabled={Boolean(existing)}
            onChange={(event) => setWorkspaceMode(event.target.value as WorkspaceMode)}
          >
            <option value="memory">记忆模式</option>
            <option value="docs">文档模式</option>
          </Select>
        </FormField>

        {workspaceMode === "memory" && (
          <FormField label="浅层记忆周期（月）" id="workspace-shallow-months">
            <Input
              id="workspace-shallow-months"
              type="number"
              min={SHALLOW_MIN}
              max={SHALLOW_MAX}
              step={1}
              aria-label="浅层记忆周期（月）"
              value={shallowMonthsText}
              invalid={shallowInvalid}
              onChange={(event) => setShallowMonthsText(event.target.value)}
            />
            {shallowInvalid && (
              <p role="alert" className="mt-1 text-body-small text-error">
                请输入 {SHALLOW_MIN}~{SHALLOW_MAX} 之间的整数
              </p>
            )}
          </FormField>
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
            disabled={nameInvalid || descInvalid || shallowInvalid || busy}
            busy={busy}
            busyText={existing ? "正在保存..." : "正在创建..."}
          >
            {existing ? "保存" : "创建"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function DeleteWorkspaceDialog({
  workspace,
  onClose,
  onDeleted,
}: {
  workspace: WorkspaceInfo;
  onClose: () => void;
  onDeleted: (deletedID: string) => Promise<void>;
}) {
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleDelete() {
    setBusy(true);
    setFailure(null);
    try {
      await api.deleteWorkspace(workspace.id);
      await onDeleted(workspace.id);
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "删除失败");
      setBusy(false);
    }
  }

  return (
    <Dialog open onClose={onClose} panelClassName="max-w-sm">
      <div className="space-y-4">
        <h2 className="text-title-large text-on-surface">删除工作区</h2>
        <p className="text-body-medium text-on-surface-variant">
          确认删除工作区「{workspace.name}」吗？仅空工作区可删除，此操作不可撤销。
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
            onClick={handleDelete}
            disabled={busy}
            busy={busy}
            busyText="正在删除..."
          >
            确认删除
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
