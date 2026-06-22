import { useEffect, useState } from "react";

/**
 * Returns a debounced copy of `value` that only updates after `delay` ms have
 * passed without `value` changing. Use this to throttle expensive work driven by
 * fast-changing input (e.g. an API search) so typing stays smooth and the
 * network/UI isn't spammed on every keystroke.
 *
 * @example
 *   const [search, setSearch] = useState("");
 *   const debouncedSearch = useDebouncedValue(search, 300);
 *   const { data } = useListProfiles(debouncedSearch ? { search: debouncedSearch } : undefined);
 */
export function useDebouncedValue<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);

  return debounced;
}
