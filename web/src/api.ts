import type {
  Envelope,
  GroupInfo,
  KeyInfo,
  ListData,
  MemoryDetail,
  MemoryInput,
  MemoryListItem,
  MemoryStatus,
  SimilarItem,
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
  if (key) headers.set("Authorization", `Bearer ${key}`);
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
    throw new ApiError("INTERNAL_ERROR", `请求失败（HTTP ${response.status}）`, response.status);
  }
  if (!envelope.success || envelope.data === null) {
    const error = envelope.error ?? { code: "INTERNAL_ERROR", message: "服务内部错误" };
    throw new ApiError(error.code, error.message, response.status);
  }
  return envelope.data;
}

export interface MemoryQuery {
  status?: MemoryStatus;
  group?: string;
  query?: string;
  offset?: number;
  limit?: number;
}

export const api = {
  me: () => request<KeyInfo>("/api/auth/me"),
  groups: () => request<ListData<GroupInfo>>("/api/groups"),
  memories: (params: MemoryQuery = {}) => {
    const search = new URLSearchParams();
    for (const [name, value] of Object.entries(params)) {
      if (value !== undefined && value !== "") search.set(name, String(value));
    }
    return request<ListData<MemoryListItem>>(`/api/memories?${search}`);
  },
  memory: (id: string) => request<MemoryDetail>(`/api/memories/${id}`),
  create: (payload: MemoryInput) =>
    request<{ id: string; similar_items: SimilarItem[] }>("/api/memories", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  update: (id: string, payload: MemoryInput) =>
    request<{ id: string; action: string }>(`/api/memories/${id}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    }),
  remove: (id: string, reason: string) =>
    request<{ id: string; action: string }>(`/api/memories/${id}`, {
      method: "DELETE",
      body: JSON.stringify({ reason }),
    }),
  restore: (id: string) =>
    request<{ id: string; action: string }>(`/api/memories/${id}/restore`, { method: "POST" }),
};
