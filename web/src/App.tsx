import { useEffect, useState } from "react";

import { ApiError, api, clearKey, getKey, setUnauthorizedHandler } from "./api";
import { Skeleton, UnauthorizedState } from "./components/ui";
import { MemoryApp } from "./memory/MemoryApp";
import { Login } from "./shell";
import type { KeyInfo } from "./types";

/** 全局守卫：只负责鉴权会话与主题持久化，业务视图全部下沉到 MemoryApp。 */
export default function App() {
  const [info, setInfo] = useState<KeyInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [expired, setExpired] = useState(false);

  const [theme, setTheme] = useState<"light" | "dark">(() => {
    return (
      (localStorage.getItem("capsa_theme") as "light" | "dark") ||
      (typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light")
    );
  });

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("capsa_theme", theme);
  }, [theme]);

  const toggleTheme = () => setTheme((t) => (t === "dark" ? "light" : "dark"));

  useEffect(() => {
    setUnauthorizedHandler(() => {
      setInfo(null);
      setExpired(true);
    });
  }, []);

  useEffect(() => {
    const key = getKey();
    if (!key) {
      setLoading(false);
      return;
    }
    let active = true;
    (async () => {
      try {
        const me = await api.me();
        if (!active) return;
        setInfo(me);
        setExpired(false);
      } catch (error) {
        // 401 已由 api 层清空凭据并触发 unauthorized 处理器，此处只兜住其余失败。
        if (active && error instanceof ApiError && error.code !== "UNAUTHORIZED") {
          clearKey();
        }
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  function connect(_key: string, me: KeyInfo) {
    setExpired(false);
    setInfo(me);
  }

  function signOut() {
    clearKey();
    setInfo(null);
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-surface">
        <Skeleton rows={3} />
      </main>
    );
  }

  if (!info) {
    return expired ? (
      <main className="grid min-h-screen place-items-center bg-surface px-4">
        <UnauthorizedState />
      </main>
    ) : (
      <Login onConnected={connect} />
    );
  }

  return (
    <MemoryApp
      info={info}
      theme={theme}
      onToggleTheme={toggleTheme}
      onSignOut={signOut}
    />
  );
}
