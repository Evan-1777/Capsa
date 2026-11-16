import { useCallback, useEffect, useRef, useState } from "react";

import { ApiError } from "./api";

export interface AsyncState<T> {
  loading: boolean;
  data: T | null;
  error: ApiError | null;
  reload: () => void;
  setData: (next: T | null) => void;
}

/** 统一的数据加载状态机：视图的加载、空、错误、未授权四态都由它驱动，支持取消前序在途请求与就地写回。 */
export function useAsync<T>(
  loader: (signal: AbortSignal) => Promise<T>,
  deps: unknown[],
): AsyncState<T> {
  const [state, setState] = useState<{ loading: boolean; data: T | null; error: ApiError | null }>({
    loading: true,
    data: null,
    error: null,
  });
  const controllerRef = useRef<AbortController | null>(null);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  const run = useCallback(() => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setState({ loading: true, data: null, error: null });

    loaderRef.current(controller.signal)
      .then((data) => {
        if (!controller.signal.aborted && controllerRef.current === controller) {
          setState({ loading: false, data, error: null });
        }
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || controllerRef.current !== controller) return;
        if (error instanceof DOMException && error.name === "AbortError") return;
        if (error instanceof Error && error.name === "AbortError") return;
        const apiError =
          error instanceof ApiError
            ? error
            : new ApiError("INTERNAL_ERROR", error instanceof Error ? error.message : "请求失败", 0);
        setState({ loading: false, data: null, error: apiError });
      });
  }, []);

  useEffect(() => {
    run();
    return () => {
      controllerRef.current?.abort();
      controllerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  const setData = useCallback((next: T | null) => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    setState({ loading: false, data: next, error: null });
  }, []);

  return { ...state, reload: run, setData };
}
