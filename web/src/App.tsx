import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from "react";

import { ApiError, api, clearKey, getKey, setUnauthorizedHandler } from "./api";
import { ErrorBanner, Skeleton, UnauthorizedState } from "./components/ui";
import { AppShell, Login, type WorkspaceShellProps } from "./shell";
import type { KeyInfo, WorkspaceInfo } from "./types";

const MemoryApp = lazy(() =>
  import("./memory/MemoryApp").then((m) => ({ default: m.MemoryApp })),
);
const DocsApp = lazy(() =>
  import("./docs/DocsApp").then((m) => ({ default: m.DocsApp })),
);
const WorkspaceSettings = lazy(() =>
  import("./shell/WorkspaceSettings").then((m) => ({ default: m.WorkspaceSettings })),
);

const WORKSPACE_STORAGE = "capsa_workspace_id";

/** 全局守卫：鉴权会话、主题持久化、工作区列表与双模视图分发。 */
export default function App() {
  const [info, setInfo] = useState<KeyInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [expired, setExpired] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authAttempt, setAuthAttempt] = useState(0);

  const [workspaces, setWorkspaces] = useState<WorkspaceInfo[] | null>(null);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string>(
    () => localStorage.getItem(WORKSPACE_STORAGE) ?? "",
  );
  const [settingsOpen, setSettingsOpen] = useState(false);

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
      setSettingsOpen(false);
      setWorkspaces(null);
    });
  }, []);

  useEffect(() => {
    const key = getKey();
    if (!key) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setAuthError(null);
    (async () => {
      try {
        const me = await api.me(controller.signal);
        if (controller.signal.aborted) return;
        setInfo(me);
        setExpired(false);
        setAuthError(null);
      } catch (error) {
        if (controller.signal.aborted) return;
        if (error instanceof DOMException && error.name === "AbortError") return;
        // 401 已由 api 层清空凭据；403 非管理员凭据清理；其余 5xx/网络抖动保留凭据允许重试。
        if (error instanceof ApiError && error.code === "UNAUTHORIZED") return;
        if (error instanceof ApiError && error.code === "FORBIDDEN") {
          clearKey();
          return;
        }
        setAuthError(error instanceof Error ? error.message : "会话校验失败，请重试");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => {
      controller.abort();
    };
  }, [authAttempt]);

  // 登录前不发起任何业务请求：工作区列表只在凭据核验通过后加载。
  useEffect(() => {
    if (!info) return;
    let active = true;
    setWorkspaceError(null);
    (async () => {
      try {
        const listed = await api.workspaces();
        if (!active) return;
        setWorkspaces(listed.items);
      } catch (error) {
        if (!active) return;
        if (error instanceof ApiError && error.code === "UNAUTHORIZED") return;
        setWorkspaceError(error instanceof Error ? error.message : "工作区列表加载失败");
      }
    })();
    return () => {
      active = false;
    };
  }, [info]);

  const reloadWorkspaces = useCallback(async () => {
    const listed = await api.workspaces();
    setWorkspaces(listed.items);
    setWorkspaceError(null);
  }, []);

  const activeWorkspace = useMemo(() => {
    if (!workspaces || workspaces.length === 0) return null;
    return (
      workspaces.find((workspace) => workspace.id === activeWorkspaceId) ??
      workspaces.find((workspace) => workspace.id === "default") ??
      workspaces[0]
    );
  }, [workspaces, activeWorkspaceId]);

  useEffect(() => {
    if (activeWorkspace) localStorage.setItem(WORKSPACE_STORAGE, activeWorkspace.id);
  }, [activeWorkspace]);

  function connect(_key: string, me: KeyInfo) {
    setExpired(false);
    setAuthError(null);
    setInfo(me);
  }

  function signOut() {
    clearKey();
    setInfo(null);
    setAuthError(null);
    setSettingsOpen(false);
    setWorkspaces(null);
  }

  function selectWorkspace(id: string) {
    setActiveWorkspaceId(id);
    setSettingsOpen(false);
  }

  const shell: WorkspaceShellProps = {
    workspaces: workspaces ?? undefined,
    activeWorkspaceId: activeWorkspace?.id,
    onSelectWorkspace: selectWorkspace,
    settingsActive: settingsOpen,
    onOpenSettings: () => setSettingsOpen(true),
  };

  const retryWorkspaces = () => {
    void reloadWorkspaces().catch((error: unknown) => {
      setWorkspaceError(error instanceof Error ? error.message : "工作区列表加载失败");
    });
  };

  if (loading) {
    return (
      <main className="min-h-screen bg-surface">
        <Skeleton rows={3} />
      </main>
    );
  }

  if (!info) {
    if (authError) {
      return (
        <main className="mx-auto flex min-h-screen max-w-xl items-center px-4">
          <div className="w-full">
            <ErrorBanner message={authError} onRetry={() => setAuthAttempt((n) => n + 1)} />
          </div>
        </main>
      );
    }
    return expired ? (
      <main className="grid min-h-screen place-items-center bg-surface px-4">
        <UnauthorizedState />
      </main>
    ) : (
      <Login onConnected={connect} />
    );
  }

  if (settingsOpen) {
    return (
      <AppShell
        info={info}
        theme={theme}
        onToggleTheme={toggleTheme}
        onSignOut={signOut}
        currentTitle="工作区设置"
        {...shell}
      >
        <Suspense fallback={<Skeleton rows={3} />}>
          <WorkspaceSettings
            workspaces={workspaces ?? []}
            activeWorkspaceId={activeWorkspace?.id}
            onReload={reloadWorkspaces}
            onSelect={selectWorkspace}
            onBack={() => setSettingsOpen(false)}
          />
        </Suspense>
      </AppShell>
    );
  }

  if (!activeWorkspace) {
    return (
      <AppShell
        info={info}
        theme={theme}
        onToggleTheme={toggleTheme}
        onSignOut={signOut}
        {...shell}
      >
        {workspaceError ? (
          <ErrorBanner message={workspaceError} onRetry={retryWorkspaces} />
        ) : (
          <Skeleton rows={3} />
        )}
      </AppShell>
    );
  }

  if (activeWorkspace.mode === "docs") {
    return (
      <Suspense fallback={<Skeleton rows={3} />}>
        <DocsApp
          key={activeWorkspace.id}
          info={info}
          theme={theme}
          onToggleTheme={toggleTheme}
          onSignOut={signOut}
          workspace={activeWorkspace}
          shell={shell}
        />
      </Suspense>
    );
  }

  return (
    <Suspense fallback={<Skeleton rows={3} />}>
      <MemoryApp
        key={activeWorkspace.id}
        info={info}
        theme={theme}
        onToggleTheme={toggleTheme}
        onSignOut={signOut}
        workspace={activeWorkspace}
        shell={shell}
      />
    </Suspense>
  );
}
