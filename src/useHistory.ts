import { useCallback, useRef, useState } from 'react';

const LIMIT = 200;
const MERGE_MS = 800;

/**
 * State with undo and redo. Changes with the same `mergeKey` close together (typing in a field,
 * dragging a slider) count as one step.
 */
export function useHistory<T>(initial: T) {
  const [present, setPresent] = useState(initial);
  const past = useRef<T[]>([]);
  const future = useRef<T[]>([]);
  const last = useRef<{ key?: string; at: number }>({ at: 0 });
  const current = useRef(initial);
  current.current = present;

  const commit = useCallback((next: T | ((prev: T) => T), mergeKey?: string) => {
    const value = typeof next === 'function' ? (next as (p: T) => T)(current.current) : next;
    const now = Date.now();
    const merge = mergeKey && last.current.key === mergeKey && now - last.current.at < MERGE_MS;
    if (!merge) {
      past.current.push(current.current);
      if (past.current.length > LIMIT) past.current.shift();
    }
    future.current = [];
    last.current = { key: mergeKey, at: now };
    current.current = value;
    setPresent(value);
  }, []);

  /** Changes without making an undo step (e.g. the moves during one drag). */
  const replace = useCallback((next: T | ((prev: T) => T)) => {
    const value = typeof next === 'function' ? (next as (p: T) => T)(current.current) : next;
    current.current = value;
    setPresent(value);
  }, []);

  /** Marks the start of a gesture: the state now is what undo returns to. */
  const checkpoint = useCallback(() => {
    past.current.push(current.current);
    if (past.current.length > LIMIT) past.current.shift();
    future.current = [];
    last.current = { at: 0 };
  }, []);

  const undo = useCallback(() => {
    const prev = past.current.pop();
    if (prev === undefined) return;
    future.current.push(current.current);
    current.current = prev;
    last.current = { at: 0 };
    setPresent(prev);
  }, []);

  const redo = useCallback(() => {
    const next = future.current.pop();
    if (next === undefined) return;
    past.current.push(current.current);
    current.current = next;
    last.current = { at: 0 };
    setPresent(next);
  }, []);

  const reset = useCallback((value: T) => {
    past.current = [];
    future.current = [];
    current.current = value;
    setPresent(value);
  }, []);

  return { present, commit, replace, checkpoint, undo, redo, reset, canUndo: past.current.length > 0, canRedo: future.current.length > 0 };
}
