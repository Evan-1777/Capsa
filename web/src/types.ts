export interface Envelope<T> {
  success: boolean;
  data: T | null;
  error: { code: string; message: string } | null;
}

export interface ListData<T> {
  items: T[];
  total: number;
  offset: number;
  limit: number;
}

export type Permission = "r" | "rw";
export type MemoryStatus = "active" | "overdue" | "deleted";

export interface MemoryListItem {
  id: string;
  group_slug: string;
  title: string;
  summary: string;
  tags: string[];
  review_at: string | null;
  pinned: number;
  updated_at: string;
  deleted_at: string | null;
  deleted_reason: string | null;
  permission: Permission;
  is_overdue: boolean;
}

export interface MemoryDetail extends MemoryListItem {
  body: string;
  created_at: string;
}

export interface GroupInfo {
  slug: string;
  workspace_id: string;
  name: string;
  description: string;
  count: number;
  permission: Permission;
}

export interface GroupInput {
  /** 仅创建时使用；slug 是记忆外键的落点，创建后不可修改。 */
  slug?: string;
  name?: string;
  description?: string;
  workspace_id?: string;
}

export type WorkspaceMode = "memory" | "docs";

export interface WorkspaceInfo {
  id: string;
  name: string;
  description: string;
  mode: WorkspaceMode;
  group_count: number;
  category_count: number;
  public_doc_count: number;
  created_at: string;
  updated_at: string;
}

export interface WorkspaceInput {
  name?: string;
  description?: string;
  mode?: WorkspaceMode;
}

export type DocScope = "public" | "category";

export interface DocCategory {
  id: string;
  workspace_id: string;
  name: string;
  description: string;
  access_id: string;
  doc_count: number;
  created_at: string;
  updated_at: string;
}

export interface DocCategoryInput {
  name?: string;
  description?: string;
}

export interface DocumentSummary {
  id: string;
  workspace_id: string;
  scope: DocScope;
  category_id: string | null;
  path: string;
  char_count: number;
  created_at: string;
  updated_at: string;
}

export interface DocumentDetail extends DocumentSummary {
  content: string;
}

export interface KeyInfo {
  key_id: string;
  name: string;
  scopes: Record<string, Permission>;
}

export interface KeyRecord {
  id: string;
  name: string;
  scopes: Record<string, Permission>;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

export interface CreateKeyInput {
  name: string;
  scopes: Record<string, Permission>;
}

export interface CreatedKeyResult {
  id: string;
  name: string;
  token: string;
  scopes: Record<string, Permission>;
  created_at: string;
}

export interface SimilarItem {
  id: string;
  title: string;
  similarity: number;
}

export interface MemoryInput {
  group?: string;
  title?: string;
  summary?: string;
  body?: string;
  tags?: string[];
  review_at?: string;
  clear_review_at?: boolean;
  pinned?: boolean;
}
