import type { ReactNode } from "react";

export function Skeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div aria-label="加载中" className="space-y-2 p-4">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="h-12 animate-pulse rounded bg-zinc-100" />
      ))}
    </div>
  );
}

export function EmptyState({ message, action }: { message: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 px-4 py-14 text-center">
      <p className="text-[13px] text-zinc-500">{message}</p>
      {action}
    </div>
  );
}

export function ErrorBanner({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="flex items-center justify-between gap-3 border-b border-red-200 bg-red-50 px-4 py-2">
      <span className="text-[13px] text-red-700">{message}</span>
      <button
        type="button"
        onClick={onRetry}
        className="rounded border border-red-300 px-2 py-1 text-xs text-red-700 hover:bg-red-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
      >
        重试
      </button>
    </div>
  );
}

export function UnauthorizedState({ message = "凭据无效或已被吊销" }: { message?: string }) {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-14 text-center">
      <p className="text-[13px] text-zinc-600">{message}</p>
      <p className="text-xs text-zinc-400">请退出后使用有效 Key 重新连接</p>
    </div>
  );
}

