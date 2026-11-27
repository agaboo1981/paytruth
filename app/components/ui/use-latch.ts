import { useRef } from 'react';

/**
 * Returns true once `value` has been true at least once (for this mount).
 * Used to keep an action card mounted after its own transaction makes the
 * action unavailable, so its final status and Explorer link stay visible.
 */
export function useLatch(value: boolean): boolean {
  const latched = useRef(false);
  if (value) latched.current = true;
  return latched.current;
}
