import React from "react";
import { Button } from "./Button";

export function Skeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div aria-label="加载中" className="space-y-2 p-4">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="h-12 animate-pulse rounded bg-stroke/40" />
      ))}
    </div>
  );
}

export function EmptyState({ message, action }: { message: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 px-4 py-14 text-center">
      <p className="text-body text-muted">{message}</p>
      {action}
    </div>
  );
}

export function ErrorBanner({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div
      role="alert"
      className="flex items-center justify-between gap-3 border-b border-danger/30 bg-danger/10 px-4 py-2"
    >
      <span className="text-body text-danger">{message}</span>
      {onRetry && (
        <Button
          variant="secondary"
          size="sm"
          onClick={onRetry}
          className="border-danger/30 text-danger hover:bg-danger/20"
        >
          重试
        </Button>
      )}
    </div>
  );
}

export function UnauthorizedState({ message = "凭据无效或已被吊销" }: { message?: string }) {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-14 text-center">
      <p className="text-body text-foreground font-medium">{message}</p>
      <p className="text-xs text-muted">请退出后使用有效 Key 重新连接</p>
    </div>
  );
}