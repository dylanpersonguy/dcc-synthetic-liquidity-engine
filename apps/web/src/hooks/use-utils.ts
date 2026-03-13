import { useState, useEffect, useCallback } from 'react';

/** Countdown timer returning seconds remaining. Returns 0 when expired. */
export function useCountdown(expiresAt: number | undefined): number {
  const [seconds, setSeconds] = useState(() =>
    expiresAt ? Math.max(0, Math.floor((expiresAt - Date.now()) / 1000)) : 0,
  );

  useEffect(() => {
    if (!expiresAt) return;
    const tick = () => setSeconds(Math.max(0, Math.floor((expiresAt - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [expiresAt]);

  return seconds;
}

/** Simple debounced value hook */
export function useDebounce<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}

/** Toggle boolean */
export function useToggle(initial = false): [boolean, () => void] {
  const [value, setValue] = useState(initial);
  const toggle = useCallback(() => setValue((v) => !v), []);
  return [value, toggle];
}
