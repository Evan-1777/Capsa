import { Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import { api } from "../api";
import type { GroupInfo } from "../types";
import {
  Button,
  Card,
  Dialog,
  EmptyState,
  ErrorBanner,
  FormField,
  Input,
  Textarea,
} from "./ui";

const SLUG_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/;
const NAME_MAX = 60;
const DESC_MAX = 200;

type Editing = { mode: "create" } | { mode: "edit"; group: GroupInfo };

export function GroupManager({
  groups,
  onGroupsChange,
}: {
  groups: GroupInfo[];
  onGroupsChange: () => Promise<void>;
}) {
  const [editing, setEditing] = useState<Editing | null>(null);
  const [deletingGroup, setDeletingGroup] = useState<GroupInfo | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  async function refresh() {
    try {
      await onGroupsChange();
      setFailure(null);
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "分类列表刷新失败");
    }
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-background">
      <div className="mx-auto max-w-3xl space-y-4 px-5 py-6">
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-sm font-semibold tracking-tight text-foreground">分类管理</h1>
          <Button
            variant="primary"
            size="sm"
            onClick={() => setEditing({ mode: "create" })}
            className="gap-1.5"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden />
            <span>新建分类</span>
          </Button>
        </div>

        {failure && <ErrorBanner message={failure} onRetry={refresh} />}

        {groups.length === 0 ? (
          <EmptyState
            message="暂无分类"
            action={
              <Button
                variant="primary"
                size="sm"
                onClick={() => setEditing({ mode: "create" })}
              >
                新建分类
              </Button>
            }
          />
        ) : (
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {groups.map((group) => (
              <Card
                as="li"
                key={group.slug}
                className="space-y-2 p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 space-y-0.5">
                    <p className="truncate text-body font-semibold text-foreground">
                      {group.name}
                    </p>
                    <p className="truncate font-mono text-caption text-muted">{group.slug}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setEditing({ mode: "edit", group })}
                      className="gap-1"
                    >
                      <Pencil className="h-3 w-3" aria-hidden />
                      <span>编辑</span>
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setDeletingGroup(group)}
                      className="gap-1 border-danger/30 text-danger hover:bg-danger/10"
                    >
                      <Trash2 className="h-3 w-3" aria-hidden />
                      <span>删除</span>
                    </Button>
                  </div>
                </div>
                <p className="line-clamp-2 text-xs leading-5 text-muted">
                  {group.description || "暂无描述"}
                </p>
                <p className="text-caption text-subtle">{group.count} 条记忆</p>
              </Card>
            ))}
          </ul>
        )}
      </div>

      {editing && (
        <GroupDialog
          editing={editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            await refresh();
            setEditing(null);
          }}
        />
      )}

      {deletingGroup && (
        <DeleteGroupDialog
          group={deletingGroup}
          onClose={() => setDeletingGroup(null)}
          onDeleted={async () => {
            await refresh();
            setDeletingGroup(null);
          }}
        />
      )}
    </div>
  );
}

function GroupDialog({
  editing,
  onClose,
  onSaved,
}: {
  editing: Editing;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const existing = editing.mode === "edit" ? editing.group : null;
  const [slug, setSlug] = useState(existing?.slug ?? "");
  const [name, setName] = useState(existing?.name ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const slugInvalid = !existing && !SLUG_PATTERN.test(slug);
  const nameInvalid = !name.trim() || name.length > NAME_MAX;
  const descInvalid = description.length > DESC_MAX;
  const invalid = slugInvalid || nameInvalid || descInvalid;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setFailure(null);
    try {
      if (existing) {
        await api.updateGroup(existing.slug, { name, description });
      } else {
        await api.createGroup({ slug, name, description });
      }
      await onSaved();
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "保存失败");
      setBusy(false);
    }
  }

  return (
    <Dialog open={true} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <h2 className="text-sm font-semibold text-foreground">
          {existing ? "编辑分类" : "新建分类"}
        </h2>

        <FormField
          label="分类标识"
          id="group-slug"
          hint={existing ? "标识不可修改" : "字母、数字、下划线或连字符，创建后不可修改"}
        >
          <Input
            id="group-slug"
            value={slug}
            aria-label="分类标识"
            disabled={Boolean(existing)}
            onChange={(event) => setSlug(event.target.value)}
            placeholder="research"
            className="font-mono"
          />
        </FormField>

        <FormField
          label="分类名称"
          id="group-name"
          counter={{
            current: name.length,
            max: NAME_MAX,
            over: name.length > NAME_MAX,
          }}
        >
          <Input
            id="group-name"
            value={name}
            aria-label="分类名称"
            invalid={name.length > NAME_MAX}
            onChange={(event) => setName(event.target.value)}
          />
        </FormField>

        <FormField
          label="分类描述"
          id="group-desc"
          counter={{
            current: description.length,
            max: DESC_MAX,
            over: description.length > DESC_MAX,
          }}
        >
          <Textarea
            id="group-desc"
            value={description}
            aria-label="分类描述"
            rows={3}
            invalid={description.length > DESC_MAX}
            onChange={(event) => setDescription(event.target.value)}
          />
        </FormField>

        {failure && (
          <p role="alert" className="text-xs text-danger">
            {failure}
          </p>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" size="sm" type="button" onClick={onClose}>
            取消
          </Button>
          <Button
            variant="primary"
            size="sm"
            type="submit"
            disabled={invalid || busy}
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

function DeleteGroupDialog({
  group,
  onClose,
  onDeleted,
}: {
  group: GroupInfo;
  onClose: () => void;
  onDeleted: () => Promise<void>;
}) {
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleDelete() {
    setBusy(true);
    setFailure(null);
    try {
      await api.deleteGroup(group.slug);
      await onDeleted();
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "删除失败");
      setBusy(false);
    }
  }

  return (
    <Dialog open={true} onClose={onClose} panelClassName="max-w-sm">
      <div className="space-y-4">
        <h2 className="text-sm font-semibold text-foreground">删除分类</h2>
        <p className="text-xs leading-5 text-muted">
          确认删除分类「{group.name}」({group.slug}) 吗？此操作不可撤销。
        </p>

        {failure && (
          <p role="alert" className="text-xs text-danger">
            {failure}
          </p>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" size="sm" type="button" onClick={onClose}>
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