import { useMemo } from 'react';
import { formatMinutes } from '../lib/date';
import { tagBars, type RangeId } from '../lib/stats';
import type { DaybookData } from '../lib/schema';
import { useElementSize } from '../hooks/useElementSize';
import { FLATLINE } from './AsciiArt';

const LABEL_W = 84;
const GAP = 10;

/**
 * Focus minutes per tag, for the range chosen above. Hand-built SVG bars: top
 * five tags plus "Other", untagged work labelled "No tag". Sorted, so the row
 * order is the answer to "where did the time go".
 */
export function TagChart({ data, range }: { data: DaybookData; range: RangeId }) {
  const rows = useMemo(() => tagBars(data, range), [data, range]);
  const { ref, size } = useElementSize<HTMLDivElement>();

  const max = Math.max(1, ...rows.map((r) => r.minutes));
  const barArea = Math.max(20, size.w - LABEL_W - GAP - 8);
  const rowH = rows.length ? Math.max(20, Math.min(30, size.h / Math.max(rows.length, 1))) : 24;
  const summary = rows.length
    ? rows.map((row) => `${row.tag} ${formatMinutes(row.minutes)}`).join(', ')
    : 'No focus sessions in this range.';

  return (
    <figure ref={ref} className="relative m-0 h-full min-h-0 w-full" aria-label={summary}>
      {rows.length === 0 ? (
        <div className="flex h-full flex-col items-center justify-center gap-3">
          <pre aria-hidden="true" className="font-mono text-[10px] leading-[1.2] text-ink-faint select-none">
            {FLATLINE}
          </pre>
          <p className="font-text text-small text-ink-mute">No focus sessions in this range yet.</p>
        </div>
      ) : (
        <svg
          width={size.w}
          height={size.h}
          viewBox={`0 0 ${size.w} ${size.h}`}
          className="block"
          style={{ maxWidth: '100%', maxHeight: '100%' }}
          role="img"
          aria-label={summary}
        >
          {rows.map((row, index) => {
            const y = index * rowH;
            const barH = Math.min(14, rowH - 8);
            const width = Math.max(2, (row.minutes / max) * barArea);
            return (
              <g key={row.tag}>
                <text
                  x={LABEL_W}
                  y={y + rowH / 2 + 4}
                  textAnchor="end"
                  fill="rgb(var(--ink-soft))"
                  style={{ font: '400 12px Geist, Verdana, sans-serif' }}
                >
                  {row.tag.length > 12 ? `${row.tag.slice(0, 11)}…` : row.tag}
                </text>
                <rect x={LABEL_W + GAP} y={y + (rowH - barH) / 2} width={barArea} height={barH} fill="rgb(var(--rule))" opacity={0.45} />
                <rect
                  x={LABEL_W + GAP}
                  y={y + (rowH - barH) / 2}
                  width={width}
                  height={barH}
                  fill="rgb(var(--ochre))"
                />
                <text
                  x={LABEL_W + GAP + width + 6}
                  y={y + rowH / 2 + 4}
                  fill="rgb(var(--ink))"
                  style={{ font: '500 12px "JetBrains Mono", monospace' }}
                >
                  {formatMinutes(row.minutes)}
                </text>
              </g>
            );
          })}
        </svg>
      )}
    </figure>
  );
}
