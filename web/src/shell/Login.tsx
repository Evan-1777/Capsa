import { useState } from "react";
import { Database } from "lucide-react";

import { ApiError, api, clearKey, setKey } from "../api";
import { Button, Card, FormField, Input } from "../components/ui";
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
    <main className="grid min-h-screen place-items-center bg-surface px-4">
      <Card variant="outlined" className="w-full max-w-sm rounded-xl p-6 sm:p-8">
        <form onSubmit={connect} className="space-y-5">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2.5">
              <span className="flex h-8 w-8 items-center justify-center rounded-sm bg-primary-container text-on-primary-container">
                <Database className="h-4 w-4" aria-hidden />
              </span>
              <h1 className="text-title-large text-on-surface">Capsa Studio</h1>
            </div>
            <p className="text-body-small text-on-surface-variant">输入管理员 API Key 以继续</p>
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
            <p role="alert" className="text-body-small text-error">
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
      </Card>
    </main>
  );
}
