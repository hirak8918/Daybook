import type { CSSProperties } from 'react';
import logoUrl from '../assets/logo.svg';

/**
 * The Daybook mark, painted with the current text colour so it can sit on
 * paper, disappear into a blurred watermark, or invert with the night theme.
 * The SVG is bundled; no request leaves the app.
 */
export function LogoMark({ className = 'h-6' }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      data-logo="true"
      className={`logo-mark block shrink-0 ${className}`}
      style={{ '--logo-mask': `url(${logoUrl})` } as CSSProperties}
    />
  );
}