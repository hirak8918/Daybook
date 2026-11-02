/**
 * ASCII marks.
 *
 * The app already draws everything with type, so its ornament is type too: a
 * halftone sun engraved in characters, a horizon rule and a few small marks for
 * the places where the interface has nothing to show yet.
 *
 * Rules:
 *   - every mark is decorative, so every mark is aria-hidden;
 *   - every mark is JetBrains Mono, the same mono face the clock and the labels
 *     use, so the ornament belongs to the type system rather than beside it;
 *   - every mark is deterministic — the same characters on every launch, no
 *     canvas, no image, no network, nothing to load.
 */

/** Density ramp. Space first, the heaviest glyph last. */
const RAMP = ' .:-=+*#%@';

/** Stable pseudo-random in [0,1) — no Math.random, so the art never changes. */
function noise(x: number, y: number): number {
  const value = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return value - Math.floor(value);
}

export type SunOptions = {
  columns?: number;
  rows?: number;
};

/**
 * A 4×4 ordered-dither matrix. Thresholding against it (rather than against
 * random noise) is what makes a printed-looking halftone instead of static: the
 * dots fall in a grid the eye reads as tone.
 */
const BAYER = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];
const threshold = (x: number, y: number) => (BAYER[y % 4][x % 4] + 0.5) / 16;

/**
 * A halftone sun: a dithered disc with a defined rim and a few stars.
 *
 * Character cells are about 0.6em wide and 1em tall, so the horizontal axis is
 * compressed before the distance is measured — without that the "sun" is an
 * ellipse, which is the one thing ASCII art almost always gets wrong.
 */
export function asciiSun({ columns = 86, rows = 32 }: SunOptions = {}): string {
  const cx = columns / 2;
  const cy = rows / 2;
  // Radius measured in rows, so 2r rows tall and 2r/0.6 columns wide: round.
  const radius = rows * 0.44;
  const lines: string[] = [];

  for (let y = 0; y < rows; y++) {
    let line = '';
    for (let x = 0; x < columns; x++) {
      const dx = (x - cx) * 0.6;
      const dy = y - cy;
      const distance = Math.hypot(dx, dy) / radius;

      if (distance <= 0.94) {
        // Ordered dither: solid core, sparser toward the rim.
        const tone = Math.pow(1 - distance, 0.55);
        line += tone > threshold(x, y) ? RAMP[Math.min(9, 3 + Math.round(tone * 6))] : ' ';
      } else if (distance <= 1.02) {
        // A crisp, unbroken rim, so the disc has an edge rather than a fade.
        line += distance > 0.985 ? '@' : '#';
      } else if (distance <= 1.18) {
        // One ring of sparse sparks.
        line += noise(x * 5 + 3, y * 5 + 9) > 0.82 ? '.' : ' ';
      } else if (noise(x, y) > 0.985) {
        line += '.';
      } else {
        line += ' ';
      }
    }
    lines.push(line.replace(/\s+$/, ''));
  }

  return lines.join('\n');
}

/** The same disc, pre-rendered once at module load. */
const SUN = asciiSun();

/**
 * The Welcome screen's one ornament: a sun over the photograph, clipped to a
 * warm gradient so it reads as light rather than as text.
 */
export function AsciiSun({ className = '', opacity = 0.55 }: { className?: string; opacity?: number }) {
  return (
    <pre
      aria-hidden="true"
      className={`pointer-events-none select-none whitespace-pre font-mono leading-[1] ${className}`}
      style={{
        opacity,
        backgroundImage:
          'linear-gradient(158deg, rgba(255, 248, 238, 0.98) 0%, rgba(255, 214, 168, 0.96) 38%, rgba(255, 150, 104, 0.9) 68%, rgba(244, 88, 58, 0.82) 100%)',
        WebkitBackgroundClip: 'text',
        backgroundClip: 'text',
        color: 'transparent',
      }}
    >
      {SUN}
    </pre>
  );
}

/** A short horizon: the rule under a heading, drawn as characters. */
export const HORIZON = '- - - - - - - - - - - - - - - - - - - -';

/**
 * The empty task list's mark: an empty checkbox. A checkbox drawn in the same
 * characters a terminal would use, which is the whole joke — nothing done yet.
 */
export const EMPTY_BOX = ['+-------+', '|       |', '|       |', '+-------+'].join('\n');

/**
 * The empty chart's mark: a dotted horizon over a flat line. The same idea as
 * the chart it sits in place of — a range with no sessions in it.
 */
export const FLATLINE = ['  .   .   .   .   .   .   .', ' ---------------------------'].join('\n');

/** A tiny sun for the boot screen, where there is no room for the big one. */
export const SMALL_SUN = asciiSun({ columns: 34, rows: 11 });
