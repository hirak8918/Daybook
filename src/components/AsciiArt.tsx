/**
 * ASCII marks.
 *
 * Every piece below was taken from the ASCII Art Archive (asciiart.eu) and is
 * reproduced with the artist's initials where they are part of the work. None
 * of it is generated at runtime and none of it is drawn by hand here: the app
 * borrows its ornament from the same terminal tradition it borrows its mono
 * face from.
 *
 * Sources
 *   SUN        "Star", artist unknown          asciiart.eu/nature/sun
 *   HOURGLASS  "Title missing", artist unknown asciiart.eu/miscellaneous/hourglass
 *   FEATHER    "Feather and Ink", llizard      asciiart.eu/miscellaneous/feathers
 *
 * Rules that keep the marks from becoming noise:
 *   - every mark is decorative, so every mark is aria-hidden;
 *   - every mark is JetBrains Mono and sits at one of three sizes (4, 7 or 10px);
 *   - a mark is never allowed to grow the page: its parents clip it.
 */

import type { CSSProperties } from 'react';

/** "Star" — a sun with a solid, typographic core. */
export const SUN = [
  '    |    ',
  '  \\ | /  ',
  '   \\*/   ',
  '--**O**--',
  '   /*\\   ',
  '  / | \\  ',
  '    |    ',
].join('\n');

/** An hourglass, the archive's plainest and most legible one. */
export const HOURGLASS = ['+====+', '|(::)|', '| )( |', '|(..)|', '+====+'].join('\n');

/** "Feather and Ink" by llizard — the empty day's writing desk. */
export const FEATHER_INK = [
  '(`/\\',
  '`=\\/\\',
  '`=\\/\\',
  '`=\\/',
  '_\\___',
  ') (',
  'ejm ( INK )',
  '\\___/',
].join('\n');

export function AsciiMark({
  art,
  className = '',
  style,
}: {
  art: string;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <pre
      aria-hidden="true"
      data-ornament="true"
      className={`pointer-events-none m-0 select-none whitespace-pre font-mono leading-[1.05] ${className}`}
      style={style}
    >
      {art}
    </pre>
  );
}
