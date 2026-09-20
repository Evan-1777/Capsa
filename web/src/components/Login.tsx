import { useState } from "react";
import { Database } from "lucide-react";

import { ApiError, api, clearKey, setKey } from "../api";
import type { KeyInfo } from "../types";
import { Button, FormField, Input } from "./ui";

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
      if (failure instanceof ApiError && failure.code === "FORBIDDEN") {
        clearKey();
        setError("管理台仅支持管理员凭据登录（需 *:rw 权限）");
      } else {
        setError(failure instanceof ApiError ? failure.message : "无法连接到服务");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center bg-background px-4">
      <form
        onSubmit={connect}
        className="w-full max-w-sm space-y-4 rounded-lg border border-stroke bg-surface p-6 shadow-card"
      >
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded bg-brand/10 text-brand">
              <Database className="h-4 w-4" aria-hidden />
            </div>
            <h1 className="text-base font-semibold tracking-tight text-foreground">Capsa Studio</h1>
          </div>
          <p className="text-xs text-muted">输入管理员 API Key 以继续</p>
        </div>

        <FormField label="API Key" id="login-key">
          <Input
            id="login-key"
            type="password"
            aria-label="API Key"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder="capsa_xxxxxxxx_..."
            autoComplete="off"
            className="font-mono"
          />
        </FormField>

        {error && (
          <p role="alert" className="text-xs text-danger">
            {error}
          </p>
        )}

        <Button
          type="submit"
          variant="primary"
          size="md"
          className="w-full"
          disabled={busy || value.trim() === ""}
          busy={busy}
          busyText="正在连接..."
        >
          连接
        </Button>
      </form>
    </main>
  );
}
