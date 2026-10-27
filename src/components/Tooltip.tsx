import { useId } from 'react';

/**
 * A rule shown behind an ⓘ rather than printed on the page: the streak rule
 * lives here, so the figure stays a figure and the explanation is one hover
 * (or one Tab) away. Keyboard reachable, and closed by Escape via focus loss.
 */
export function InfoTip({ label, text }: { label: string; text: string }) {
  const id = useId();
  return (
    <span className="group relative inline-flex align-middle">
      <button
        type="button"
        aria-label={label}
        aria-describedby={id}
        className="flex h-5 w-5 items-center justify-center rounded-full border border-ink-mute font-mono text-[12px] leading-none text-ink-mute transition-colors hover:border-ink hover:text-ink"
      >
        i
      </button>
      <span
        id={id}
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 z-30 mb-2 hidden w-[19rem] -translate-x-1/2 border border-ink bg-paper px-3 py-2 font-text text-micro leading-snug text-ink-soft shadow-offset-sm group-hover:block group-focus-within:block"
      >
        {text}
      </span>
    </span>
  );
}
