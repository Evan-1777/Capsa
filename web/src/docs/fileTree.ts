import type { DocumentSummary } from "../types";

export interface TreeFolderNode {
  kind: "folder";
  name: string;
  path: string;
  children: TreeNode[];
  fileCount: number;
}

export interface TreeFileNode {
  kind: "file";
  name: string;
  path: string;
  doc: DocumentSummary;
}

export type TreeNode = TreeFolderNode | TreeFileNode;

function compareNames(a: string, b: string): number {
  const ci = a.toLowerCase().localeCompare(b.toLowerCase());
  if (ci !== 0) return ci;
  return a < b ? -1 : a > b ? 1 : 0;
}

interface FolderBuilder {
  folders: Map<string, FolderBuilder>;
  files: TreeFileNode[];
}

function finalizeLevel(builder: FolderBuilder, prefix: string): TreeNode[] {
  const folderNodes: TreeFolderNode[] = [];
  for (const [name, child] of builder.folders) {
    const path = prefix ? `${prefix}/${name}` : name;
    const children = finalizeLevel(child, path);
    let fileCount = 0;
    for (const node of children) {
      fileCount += node.kind === "folder" ? node.fileCount : 1;
    }
    folderNodes.push({ kind: "folder", name, path, children, fileCount });
  }
  folderNodes.sort((a, b) => compareNames(a.name, b.name));
  const fileNodes = [...builder.files].sort((a, b) => compareNames(a.name, b.name));
  return [...folderNodes, ...fileNodes];
}

export function buildFileTree(docs: DocumentSummary[]): TreeNode[] {
  const root: FolderBuilder = { folders: new Map(), files: [] };

  for (const doc of docs) {
    const parts = doc.path.split("/").filter(Boolean);
    if (parts.length === 0) continue;
    let cursor = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const segment = parts[i];
      let next = cursor.folders.get(segment);
      if (!next) {
        next = { folders: new Map(), files: [] };
        cursor.folders.set(segment, next);
      }
      cursor = next;
    }
    cursor.files.push({
      kind: "file",
      name: parts[parts.length - 1],
      path: doc.path,
      doc,
    });
  }

  return finalizeLevel(root, "");
}

export function listDirectoryEntries(
  roots: TreeNode[],
  dirPath: string,
): { folders: TreeFolderNode[]; files: TreeFileNode[]; exists: boolean } {
  let children = roots;
  const parts = dirPath.split("/").filter(Boolean);
  for (const segment of parts) {
    const folder = children.find(
      (node): node is TreeFolderNode => node.kind === "folder" && node.name === segment,
    );
    if (!folder) {
      return { folders: [], files: [], exists: false };
    }
    children = folder.children;
  }
  const folders: TreeFolderNode[] = [];
  const files: TreeFileNode[] = [];
  for (const node of children) {
    if (node.kind === "folder") {
      folders.push(node);
    } else {
      files.push(node);
    }
  }
  return { folders, files, exists: true };
}

export function ancestorDirs(docOrDirPath: string): string[] {
  const parts = docOrDirPath.split("/").filter(Boolean);
  const dirs: string[] = [];
  for (let i = 0; i < parts.length - 1; i++) {
    dirs.push(parts.slice(0, i + 1).join("/"));
  }
  return dirs;
}

export function splitBreadcrumbs(path: string): { label: string; path: string }[] {
  const parts = path.split("/").filter(Boolean);
  return parts.map((label, index) => ({
    label,
    path: parts.slice(0, index + 1).join("/"),
  }));
}

export function parentDir(docOrDirPath: string): string {
  const parts = docOrDirPath.split("/").filter(Boolean);
  if (parts.length <= 1) return "";
  return parts.slice(0, -1).join("/");
}
