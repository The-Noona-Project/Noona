import { useEffect, useMemo, useState } from 'react';

type BreakpointKey = 'base' | 'sm' | 'md' | 'lg' | 'xl';

const BREAKPOINT_QUERIES: Record<Exclude<BreakpointKey, 'base'>, string> = {
  sm: '(min-width: 30em)',
  md: '(min-width: 48em)',
  lg: '(min-width: 62em)',
  xl: '(min-width: 80em)',
};

export type BreakpointMap<T> = Partial<Record<BreakpointKey, T>>;

function resolveValue<T>(map: BreakpointMap<T>): T | undefined {
  const order: BreakpointKey[] = ['base', 'sm', 'md', 'lg', 'xl'];
  if (typeof window === 'undefined') {
    for (const key of order) {
      if (map[key] !== undefined) {
        return map[key];
      }
    }
    return undefined;
  }

  let value: T | undefined = map.base;
  (['sm', 'md', 'lg', 'xl'] as Array<Exclude<BreakpointKey, 'base'>>).forEach((key) => {
    if (map[key] === undefined) {
      return;
    }
    const media = window.matchMedia(BREAKPOINT_QUERIES[key]);
    if (media.matches) {
      value = map[key];
    }
  });
  if (value !== undefined) {
    return value;
  }
  for (const key of order) {
    if (map[key] !== undefined) {
      return map[key];
    }
  }
  return undefined;
}

export function useBreakpointValue<T>(map: BreakpointMap<T>): T | undefined {
  const stableMap = useMemo(() => map, [JSON.stringify(map)]);
  const [value, setValue] = useState<T | undefined>(() => resolveValue(stableMap));

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }
    const handleChange = () => {
      setValue(resolveValue(stableMap));
    };

    const mediaQueries = (['sm', 'md', 'lg', 'xl'] as Array<Exclude<BreakpointKey, 'base'>>) // as const
      .filter((key) => stableMap[key] !== undefined)
      .map((key) => ({ key, media: window.matchMedia(BREAKPOINT_QUERIES[key]) }));

    mediaQueries.forEach(({ media }) => {
      media.addEventListener('change', handleChange);
    });

    return () => {
      mediaQueries.forEach(({ media }) => {
        media.removeEventListener('change', handleChange);
      });
    };
  }, [stableMap]);

  return value;
}

export default useBreakpointValue;
