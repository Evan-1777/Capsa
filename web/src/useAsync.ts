import { useCallback, useEffect, useState } from "react";

import { ApiError } from "./api";

export interface AsyncState<T> {
  loading: boolean;
  data: T | null;
  error: ApiError | null;
  reload: () => void;
}

/** 统一的数据加载状态机：视图的加载、空、错误、未授权四态都由它驱动。 */
export function useAsync<T>(loader: () => Promise<T>, deps: unknown[]): AsyncState<T> {
  const [state, setState] = useState<{ loading: boolean; data: T | null; error: ApiError | null }>({
    loading: true,
    data: null,
    error: null,
  });
  const load = useCallback(() => {
    let active = true;
    setState({ loading: true, data: null, error: null });
    loader()
      .then((data) => active && setState({ loading: false, data, error: null }))
      .catch((error: ApiError) => active && setState({ loading: false, data: null, error }));
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(load, [load]);
  return { ...state, reload: load };
}
