import { useEffect, useState } from 'react';

/** useState backed by localStorage (best effort — falls back to memory if storage is unavailable). */
export function usePersistentState<T>(key: string, initial: T | (() => T)) {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw !== null) return JSON.parse(raw) as T;
    } catch {
      // ignore
    }
    return typeof initial === 'function' ? (initial as () => T)() : initial;
  });

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // ignore (quota exceeded, private mode, …)
    }
  }, [key, value]);

  return [value, setValue] as const;
}
