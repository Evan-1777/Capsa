import React from "react";

import { Button } from "./Button";

export function Skeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div aria-label="加载中" className="space-y-2 p-4">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="h-12 animate-pulse rounded-md bg-surface-container-highest" />
      ))}
    </div>
  );
}

export function EmptyState({ message, action }: { message: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 px-4 py-14 text-center">
      <p className="text-body-medium text-on-surface-variant">{message}</p>
      {action}
    </div>
  );
}

export function ErrorBanner({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div
      role="alert"
      className="flex items-center justify-between gap-3 bg-error-container px-4 py-3 text-on-error-container"
    >
      <span className="text-body-medium">{message}</span>
      {onRetry && (
        <Button variant="text" size="sm" onClick={onRetry} className="text-on-error-container">
          重试
        </Button>
      )}
    </div>
  );
}

export function UnauthorizedState({ message = "凭据无效或已被吊销" }: { message?: string }) {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-14 text-center">
      <p className="text-body-large font-medium text-on-surface">{message}</p>
      <p className="text-body-small text-on-surface-variant">请退出后使用有效 Key 重新连接</p>
    </div>
  );
}
