import { Database, LogOut, ShieldCheck } from "lucide-react";

import type { KeyInfo } from "../types";

export function Header({ info, onSignOut }: { info: KeyInfo; onSignOut: () => void }) {
  return (
    <header className="flex items-center justify-between gap-4 border-b border-zinc-200 bg-white px-4 py-3">
      <div className="flex min-w-0 items-center gap-2">
        <Database className="h-4 w-4 shrink-0 text-zinc-400" aria-hidden />
        <span className="text-sm font-semibold tracking-tight">Capsa Studio</span>
        <span className="hidden truncate text-xs text-zinc-400 sm:inline">{info.name}</span>
      </div>
      <div className="flex items-center gap-3">
        <span className="hidden items-center gap-1 text-xs text-zinc-500 sm:flex">
          <ShieldCheck className="h-3.5 w-3.5 text-zinc-400" aria-hidden />
          管理员
        </span>
        <button
          type="button"
          onClick={onSignOut}
          className="flex items-center gap-1.5 rounded border border-zinc-300 px-2.5 py-1 text-xs text-zinc-700 hover:bg-zinc-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        >
          <LogOut className="h-3.5 w-3.5" aria-hidden />
          退出
        </button>
      </div>
    </header>
  );
}
