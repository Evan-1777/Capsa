import { useState } from "react";

import { api } from "../api";
import { Button, Dialog, FormField, Input, Textarea } from "../components/ui";
import type { DocCategory, DocScope, DocumentDetail } from "../types";

const NAME_MAX = 60;
const DESC_MAX = 200;

export type CategoryEditing = { mode: "create" } | { mode: "edit"; category: DocCategory };

export function CategoryDialog({
  workspaceId,
  editing,
  onClose,
  onSaved,
}: {
  workspaceId: string;
  editing: CategoryEditing;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const existing = editing.mode === "edit" ? editing.category : null;
  const [name, setName] = useState(existing?.name ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const nameInvalid = !name.trim() || name.length > NAME_MAX;
  const descInvalid = description.length > DESC_MAX;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setFailure(null);
    try {
      if (existing) {
        await api.updateDocCategory(workspaceId, existing.id, { name, description });
      } else {
        await api.createDocCategory(workspaceId, { name, description });
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
          {existing ? "编辑子项目" : "新建子项目"}
        </h2>

        <FormField
          label="子项目名称"
          id="doc-category-name"
          counter={{ current: name.length, max: NAME_MAX, over: name.length > NAME_MAX }}
        >
          <Input
            id="doc-category-name"
            aria-label="子项目名称"
            value={name}
            invalid={name.length > NAME_MAX}
            onChange={(event) => setName(event.target.value)}
            placeholder="例如：接口规范"
          />
        </FormField>

        <FormField
          label="子项目描述"
          id="doc-category-desc"
          counter={{
            current: description.length,
            max: DESC_MAX,
            over: description.length > DESC_MAX,
          }}
        >
          <Textarea
            id="doc-category-desc"
            aria-label="子项目描述"
            rows={3}
            value={description}
            invalid={description.length > DESC_MAX}
            onChange={(event) => setDescription(event.target.value)}
          />
        </FormField>

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
            disabled={nameInvalid || descInvalid || busy}
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

export function DeleteCategoryDialog({
  workspaceId,
  category,
  onClose,
  onDeleted,
}: {
  workspaceId: string;
  category: DocCategory;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleDelete() {
    setBusy(true);
    setFailure(null);
    try {
      await api.deleteDocCategory(workspaceId, category.id);
      onDeleted();
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "删除失败");
      setBusy(false);
    }
  }

  return (
    <Dialog open onClose={onClose} panelClassName="max-w-sm">
      <div className="space-y-4">
        <h2 className="text-title-large text-on-surface">删除子项目</h2>
        <p className="text-body-medium text-on-surface-variant">
          确认删除子项目「{category.name}」吗？仅空子项目可删除，此操作不可撤销。
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

export function DocumentDialog({
  workspaceId,
  scope,
  categoryId,
  initialDir,
  onClose,
  onCreated,
}: {
  workspaceId: string;
  scope: DocScope;
  categoryId?: string;
  initialDir?: string;
  onClose: () => void;
  onCreated: (document: DocumentDetail) => void;
}) {
  const [documentPath, setDocumentPath] = useState(() => (initialDir ? `${initialDir}/` : ""));
  const [content, setContent] = useState("");
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setFailure(null);
    try {
      const created = await api.createDoc(workspaceId, {
        scope,
        category_id: categoryId,
        path: documentPath,
        content,
      });
      onCreated(created);
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "创建失败");
      setBusy(false);
    }
  }

  return (
    <Dialog open onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <h2 className="text-title-large text-on-surface">新建文档</h2>

        <FormField
          label="文档路径"
          id="document-path"
          hint="允许斜杠分层，例如 guides/overview.md；可直接修改前缀以调整所属目录，同名文档不会被覆盖"
        >
          <Input
            id="document-path"
            aria-label="文档路径"
            value={documentPath}
            onChange={(event) => setDocumentPath(event.target.value)}
            placeholder="guides/overview.md"
            className="font-mono"
          />
        </FormField>

        <FormField label="初始正文" id="document-content">
          <Textarea
            id="document-content"
            aria-label="初始正文"
            rows={8}
            value={content}
            onChange={(event) => setContent(event.target.value)}
            className="font-mono"
          />
        </FormField>

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
            disabled={!documentPath.trim() || busy}
            busy={busy}
            busyText="正在创建..."
          >
            创建
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

export function RenameDocumentDialog({
  workspaceId,
  document,
  onClose,
  onRenamed,
}: {
  workspaceId: string;
  document: DocumentDetail;
  onClose: () => void;
  onRenamed: () => void;
}) {
  const [documentPath, setDocumentPath] = useState(document.path);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setFailure(null);
    try {
      await api.updateDoc(workspaceId, document.id, { path: documentPath });
      onRenamed();
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "重命名失败");
      setBusy(false);
    }
  }

  return (
    <Dialog open onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <h2 className="text-title-large text-on-surface">重命名文档</h2>

        <FormField
          label="文档路径"
          id="rename-path"
          hint="同作用域下路径必须唯一；修改斜杠目录段即可移动文档所属文件夹"
        >
          <Input
            id="rename-path"
            aria-label="文档路径"
            value={documentPath}
            onChange={(event) => setDocumentPath(event.target.value)}
            className="font-mono"
          />
        </FormField>

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
            disabled={!documentPath.trim() || busy}
            busy={busy}
            busyText="正在保存..."
          >
            保存
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

export function DeleteDocumentDialog({
  workspaceId,
  document,
  onClose,
  onDeleted,
}: {
  workspaceId: string;
  document: DocumentDetail;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleDelete() {
    setBusy(true);
    setFailure(null);
    try {
      await api.deleteDoc(workspaceId, document.id);
      onDeleted();
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "删除失败");
      setBusy(false);
    }
  }

  return (
    <Dialog open onClose={onClose} panelClassName="max-w-sm">
      <div className="space-y-4">
        <h2 className="text-title-large text-on-surface">删除文档</h2>
        <p className="text-body-medium text-on-surface-variant">
          确认删除「{document.path}」吗？文档将被物理删除，无法恢复。
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
