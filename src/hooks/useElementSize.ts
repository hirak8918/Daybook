import { useEffect, useRef, useState } from 'react';

/**
 * Measure an element and keep the size current. Charts use this so their SVG
 * viewBox matches the real pixel box: text stays crisp, bars fill the width,
 * and nothing is ever scaled non-uniformly to fit.
 */
export function useElementSize<T extends HTMLElement>(fallback = { w: 760, h: 200 }) {
  const ref = useRef<T>(null);
  const [size, setSize] = useState(fallback);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect) return;
      setSize((current) => {
        const next = { w: Math.max(280, Math.round(rect.width)), h: Math.max(120, Math.round(rect.height)) };
        return current.w === next.w && current.h === next.h ? current : next;
      });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return { ref, size };
}
