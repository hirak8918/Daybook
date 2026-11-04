import { useMemo, useState } from 'react';
import { useReducedMotion } from 'framer-motion';
import { formatMinutes, formatMinutesShort } from '../lib/date';
import { focusBars, type Bar, type RangeId } from '../lib/stats';
import type { DaybookData } from '../lib/schema';
import { useElementSize } from '../hooks/useElementSize';

const PAD = { top: 20, right: 12, bottom: 24, left: 48 };

const RANGE_WORD: Record<RangeId, string> = {
  '30D': 'last 30 days',
  '12W': 'last 12 weeks',
  '1Y': 'last 12 months',
};

/**
 * Focus time per day, week or month — hand-built SVG, no chart library, drawn
 * at the measured pixel size of its box so the type stays crisp and the bars
 * fill the width. Bars are ink; today's bar is full strength with an accent
 * foot rule. The dashed ochre line is the daily goal, drawn where it means
 * something (30D). Nothing after today is ever drawn.
 *
 * The SVG is capped at 100% of its column in both axes: before the resize
 * observer has reported (and if it never does), the fallback size must not be
 * able to push the page past the window.
 */
export function FocusChart({ data, range }: { data: DaybookData; range: RangeId }) {
  const reduced = useReducedMotion();
  const bars = useMemo(() => focusBars(data, range), [data, range]);
  const [active, setActive] = useState<number | null>(null);
  const { ref, size } = useElementSize<HTMLDivElement>();

  const goal = data.settings.goals.deepWorkMin;
  const maxValue = Math.max(60, ...bars.map((b) => b.value), range === '30D' ? goal : 0);
  const niceMax = niceCeil(maxValue);

  const innerW = Math.max(40, size.w - PAD.left - PAD.right);
  const innerH = Math.max(40, size.h - PAD.top - PAD.bottom);
  const slot = innerW / bars.length;
  const barW = Math.max(3, Math.min(34, slot * 0.6));
  const y = (value: number) => PAD.top + innerH - (value / niceMax) * innerH;

  const total = bars.reduce((a, b) => a + b.value, 0);
  const bestBar = bars.reduce<Bar | null>((best, bar) => (bar.value > (best?.value ?? 0) ? bar : best), null);
  const tickEvery = Math.max(1, Math.ceil(bars.length / 7));
  const summary = `Focus time over the ${RANGE_WORD[range]}: ${formatMinutes(total)} in total, best ${formatMinutes(
    bestBar?.value ?? 0,
  )}${bestBar ? ` on ${bestBar.label}` : ''}.`;

  const activeBar = active !== null ? bars[active] : null;

  if (total === 0) {
    return (
      <div ref={ref} className="relative flex h-full min-h-0 w-full flex-col items-center justify-center gap-3">
        <p className="font-text text-small text-ink-mute">No focus time yet.</p>
      </div>
    );
  }

  return (
    <figure ref={ref} className="relative m-0 h-full min-h-0 w-full">
      <svg
        width={size.w}
        height={size.h}
        viewBox={`0 0 ${size.w} ${size.h}`}
        className="block"
        style={{ maxWidth: '100%', maxHeight: '100%' }}
        role="img"
        aria-label={summary}
        onMouseLeave={() => setActive(null)}
      >
        {[0, 0.5, 1].map((fraction) => {
          const value = niceMax * fraction;
          return (
            <g key={fraction}>
              <line x1={PAD.left} x2={size.w - PAD.right} y1={y(value)} y2={y(value)} stroke="rgb(var(--rule))" strokeWidth={1} />
              <text
                x={PAD.left - 8}
                y={y(value) + 4}
                textAnchor="end"
                fill="rgb(var(--ink-mute))"
                style={{ font: '500 12px Fraunces, Georgia, serif' }}
              >
                {formatMinutesShort(value)}
              </text>
            </g>
          );
        })}

        {range === '30D' && goal <= niceMax ? (
          <line
            x1={PAD.left}
            x2={size.w - PAD.right}
            y1={y(goal)}
            y2={y(goal)}
            stroke="rgb(var(--ochre))"
            strokeWidth={1.5}
            strokeDasharray="6 6"
          />
        ) : null}

        {bars.map((bar, index) => {
          const x = PAD.left + index * slot + (slot - barW) / 2;
          const top = y(bar.value);
          const height = PAD.top + innerH - top;
          return (
            <g key={bar.key}>
              <rect
                x={PAD.left + index * slot}
                y={PAD.top}
                width={slot}
                height={innerH}
                fill="transparent"
                onMouseEnter={() => setActive(index)}
              />
              {bar.value > 0 ? (
                <rect
                  x={x}
                  y={top}
                  width={barW}
                  height={height}
                  fill={bar.isToday ? 'rgb(var(--ink))' : 'rgb(var(--ink) / 0.5)'}
                  style={{ transition: reduced ? 'none' : 'height 260ms cubic-bezier(0.16, 0.84, 0.44, 1)' }}
                />
              ) : null}
              {bar.isToday ? <rect x={x} y={PAD.top + innerH + 1} width={barW} height={2} fill="rgb(var(--accent))" /> : null}
              {active === index && bar.value > 0 ? (
                <rect x={x} y={top} width={barW} height={height} fill="rgb(var(--ochre))" opacity={0.9} />
              ) : null}
              {index % tickEvery === 0 ? (
                <text
                  x={PAD.left + index * slot + slot / 2}
                  y={size.h - 8}
                  textAnchor="middle"
                  fill="rgb(var(--ink-mute))"
                  style={{ font: '500 12px Fraunces, Georgia, serif' }}
                >
                  {bar.label}
                </text>
              ) : null}
            </g>
          );
        })}

        <line
          x1={PAD.left}
          x2={size.w - PAD.right}
          y1={PAD.top + innerH}
          y2={PAD.top + innerH}
          stroke="rgb(var(--ink))"
          strokeWidth={1}
        />
      </svg>

      {activeBar ? (
        <div
          className="pointer-events-none absolute top-0 z-20 rounded-control border border-rule bg-paper-raise px-2 py-1 font-text text-micro text-ink shadow-lift"
          style={{
            left: `${((PAD.left + (active ?? 0) * slot + slot / 2) / Math.max(1, size.w)) * 100}%`,
            transform: 'translateX(-50%)',
          }}
        >
          <span className="tab">{formatMinutes(activeBar.value)}</span>
          <span className="text-ink-mute">{range === '30D' ? ` · ${activeBar.label}` : ` · ${activeBar.label}`}</span>
        </div>
      ) : null}
    </figure>
  );
}

function niceCeil(value: number): number {
  if (value <= 60) return 60;
  const step = value <= 240 ? 30 : value <= 600 ? 60 : 120;
  return Math.ceil(value / step) * step;
}
