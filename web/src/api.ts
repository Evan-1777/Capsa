import type {
  CreatedKeyResult,
  CreateKeyInput,
  DocCategory,
  DocCategoryInput,
  DocScope,
  DocumentDetail,
  DocumentSummary,
  Envelope,
  GroupInfo,
  GroupInput,
  KeyInfo,
  KeyRecord,
  ListData,
  MemoryDetail,
  MemoryInput,
  MemoryListItem,
  MemoryStatus,
  MemoryTier,
  SimilarItem,
  UpdateKeyInput,
  WorkspaceInfo,
  WorkspaceInput,
  WorkspaceMode,
} from "./types";

const KEY_STORAGE = "capsa_key";

export class ApiError extends Error {
  constructor(readonly code: string, message: string, readonly status: number) {
    super(message);
    this.name = "ApiError";
  }
}

export const getKey = (): string | null => sessionStorage.getItem(KEY_STORAGE);
export const setKey = (key: string): void => sessionStorage.setItem(KEY_STORAGE, key);
export const clearKey = (): void => sessionStorage.removeItem(KEY_STORAGE);

let onUnauthorized: (() => void) | null = null;
export const setUnauthorizedHandler = (handler: () => void): void => {
  onUnauthorized = handler;
};

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const key = getKey();
  const headers = new Headers(init.headers);
  if (init.body !== undefined) headers.set("Content-Type", "application/json");
  if (key) headers.set("Authorization", "Bearer " + key);
  const response = await fetch(path, { ...init, headers });
  if (response.status === 401) {
    clearKey();
    onUnauthorized?.();
    throw new ApiError("UNAUTHORIZED", "凭据无效或已被吊销", 401);
  }
  let envelope: Envelope<T>;
  try {
    envelope = (await response.json()) as Envelope<T>;
  } catch {
    throw new ApiError("INTERNAL_ERROR", "请求失败（HTTP " + response.status + "）", response.status);
  }
  if (!envelope.success || envelope.data === null) {
    const error = envelope.error ?? { code: "INTERNAL_ERROR", message: "服务内部错误" };
    throw new ApiError(error.code, error.message, response.status);
  }
  return envelope.data;
}

function queryString(params: object): string {
  const search = new URLSearchParams();
  for (const [name, value] of Object.entries(params) as [string, unknown][]) {
    if (value !== undefined && value !== "") search.set(name, String(value));
  }
  return search.toString();
}

export interface MemoryQuery {
  status?: MemoryStatus;
  tier?: MemoryTier;
  group?: string;
  query?: string;
  offset?: number;
  limit?: number;
  workspace_id?: string;
}

export interface DocListQuery {
  scope: DocScope;
  category_id?: string;
  query?: string;
}

export const api = {
  me: (signal?: AbortSignal) => request<KeyInfo>("/api/auth/me", { signal }),

  groups: (workspaceId?: string, signal?: AbortSignal) =>
    request<ListData<GroupInfo>>("/api/groups?" + queryString({ workspace_id: workspaceId }), { signal }),
  createGroup: (payload: GroupInput & { slug: string; name: string }) =>
    request<GroupInfo>("/api/groups", { method: "POST", body: JSON.stringify(payload) }),
  updateGroup: (slug: string, payload: GroupInput) =>
    request<GroupInfo>("/api/groups/" + slug, { method: "PUT", body: JSON.stringify(payload) }),
  deleteGroup: (slug: string) =>
    request<{ slug: string; action: string }>("/api/groups/" + slug, { method: "DELETE" }),

  keys: (signal?: AbortSignal) => request<ListData<KeyRecord>>("/api/keys", { signal }),
  createKey: (payload: CreateKeyInput) =>
    request<CreatedKeyResult>("/api/keys", { method: "POST", body: JSON.stringify(payload) }),
  updateKey: (id: string, payload: UpdateKeyInput) =>
    request<KeyRecord>("/api/keys/" + id, { method: "PUT", body: JSON.stringify(payload) }),
  revokeKey: (id: string) =>
    request<{ id: string; action: string }>("/api/keys/" + id + "/revoke", { method: "POST" }),
  deleteKey: (id: string) =>
    request<{ id: string; action: string }>("/api/keys/" + id, { method: "DELETE" }),

  memories: (params: MemoryQuery = {}, signal?: AbortSignal) =>
    request<ListData<MemoryListItem>>("/api/memories?" + queryString(params), { signal }),
  memory: (id: string, signal?: AbortSignal) => request<MemoryDetail>("/api/memories/" + id, { signal }),
  create: (payload: MemoryInput) =>
    request<{ id: string; similar_items: SimilarItem[] }>("/api/memories", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  update: (id: string, payload: MemoryInput) =>
    request<{ id: string; action: string }>("/api/memories/" + id, {
      method: "PUT",
      body: JSON.stringify(payload),
    }),
  remove: (id: string, reason: string) =>
    request<{ id: string; action: string }>("/api/memories/" + id, {
      method: "DELETE",
      body: JSON.stringify({ reason }),
    }),
  restore: (id: string, payload?: { expires_at?: string }) =>
    request<{ id: string; action: string }>("/api/memories/" + id + "/restore", {
      method: "POST",
      ...(payload && payload.expires_at ? { body: JSON.stringify(payload) } : {}),
    }),
  purgeMemory: (id: string) =>
    request<{ id: string; action: string }>("/api/memories/" + id + "/purge", { method: "DELETE" }),
  emptyTrash: (payload?: { workspace_id?: string; group?: string }) =>
    request<{ deleted_count: number; action: string }>("/api/memories/trash/empty", {
      method: "POST",
      ...(payload ? { body: JSON.stringify(payload) } : {}),
    }),

  workspaces: (signal?: AbortSignal) => request<ListData<WorkspaceInfo>>("/api/workspaces", { signal }),
  createWorkspace: (payload: {
    name: string;
    description?: string;
    mode: WorkspaceMode;
    shallow_months?: number;
  }) =>
    request<WorkspaceInfo>("/api/workspaces", { method: "POST", body: JSON.stringify(payload) }),
  updateWorkspace: (id: string, payload: WorkspaceInput) =>
    request<WorkspaceInfo>("/api/workspaces/" + id, { method: "PUT", body: JSON.stringify(payload) }),
  deleteWorkspace: (id: string) =>
    request<{ id: string; action: string }>("/api/workspaces/" + id, { method: "DELETE" }),

  docCategories: (workspaceId: string, signal?: AbortSignal) =>
    request<ListData<DocCategory>>("/api/workspaces/" + workspaceId + "/categories", { signal }),
  createDocCategory: (workspaceId: string, payload: DocCategoryInput & { name: string }) =>
    request<DocCategory>("/api/workspaces/" + workspaceId + "/categories", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  reorderDocCategories: (workspaceId: string, ids: string[]) =>
    request<ListData<DocCategory>>("/api/workspaces/" + workspaceId + "/categories/reorder", {
      method: "PUT",
      body: JSON.stringify({ ids }),
    }),
  updateDocCategory: (workspaceId: string, categoryId: string, payload: DocCategoryInput) =>
    request<DocCategory>("/api/workspaces/" + workspaceId + "/categories/" + categoryId, {
      method: "PUT",
      body: JSON.stringify(payload),
    }),
  deleteDocCategory: (workspaceId: string, categoryId: string) =>
    request<{ id: string; action: string }>(
      "/api/workspaces/" + workspaceId + "/categories/" + categoryId,
      { method: "DELETE" },
    ),
  rotateDocCategoryToken: (workspaceId: string, categoryId: string) =>
    request<DocCategory>(
      "/api/workspaces/" + workspaceId + "/categories/" + categoryId + "/rotate-token",
      { method: "POST" },
    ),

  docs: (workspaceId: string, params: DocListQuery, signal?: AbortSignal) =>
    request<ListData<DocumentSummary>>(
      "/api/workspaces/" + workspaceId + "/docs?" + queryString(params),
      { signal },
    ),
  doc: (workspaceId: string, documentId: string, signal?: AbortSignal) =>
    request<DocumentDetail>("/api/workspaces/" + workspaceId + "/docs/" + documentId, { signal }),
  createDoc: (
    workspaceId: string,
    payload: { scope: DocScope; category_id?: string; path: string; content: string },
  ) =>
    request<DocumentDetail>("/api/workspaces/" + workspaceId + "/docs", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  updateDoc: (
    workspaceId: string,
    documentId: string,
    payload: { path?: string; content?: string },
  ) =>
    request<DocumentDetail>("/api/workspaces/" + workspaceId + "/docs/" + documentId, {
      method: "PUT",
      body: JSON.stringify(payload),
    }),
  deleteDoc: (workspaceId: string, documentId: string) =>
    request<{ id: string; action: string }>(
      "/api/workspaces/" + workspaceId + "/docs/" + documentId,
      { method: "DELETE" },
    ),
};
