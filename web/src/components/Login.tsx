import { useState } from "react";

import { ApiError, api, setKey } from "../api";
import type { KeyInfo } from "../types";

export function Login({ onConnected }: { onConnected: (key: string, info: KeyInfo) => void }) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function connect(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const key = value.trim();
    setKey(key);
    try {
      onConnected(key, await api.me());
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : "无法连接到服务");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center bg-zinc-100 px-4">
      <form
        onSubmit={connect}
        className="w-full max-w-sm space-y-4 rounded-lg border border-zinc-200 bg-white p-6"
      >
        <div className="space-y-1">
          <h1 className="text-base font-semibold tracking-tight">Capsa Studio</h1>
          <p className="text-xs text-zinc-500">输入服务端签发的 API Key 以继续</p>
        </div>
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-zinc-600">API Key</span>
          <input
            type="password"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder="capsa_xxxxxxxx_..."
            autoComplete="off"
            className="w-full rounded border border-zinc-300 px-3 py-2 font-mono text-sm focus:border-blue-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          />
        </label>
        {error && (
          <p role="alert" className="text-xs text-red-600">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={busy || value.trim() === ""}
          className="w-full rounded bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        >
          连接
        </button>
      </form>
    </main>
  );
}
