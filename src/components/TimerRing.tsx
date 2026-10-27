import { useReducedMotion } from 'framer-motion';
import type { ReactNode } from 'react';

/**
 * The timer dial, simplified: one thin track and one arc of ink. No engraved
 * ticks, no travelling marker — the digits are the instrument, the arc is the
 * progress.
 */
export function TimerRing({
  progress,
  size = 320,
  label,
  children,
}: {
  progress: number;
  size?: number;
  label?: string;
  children?: ReactNode;
}) {
  const reduced = useReducedMotion();
  const stroke = 4;
  const r = size / 2 - stroke * 2;
  const c = size / 2;
  const pct = Math.max(0, Math.min(1, progress)) * 100;

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label}>
        <circle cx={c} cy={c} r={r} fill="none" stroke="rgb(var(--rule-strong))" strokeWidth={stroke} />
        <circle
          cx={c}
          cy={c}
          r={r}
          fill="none"
          stroke="rgb(var(--accent))"
          strokeWidth={stroke}
          pathLength={100}
          strokeDasharray={`${pct} 100`}
          strokeLinecap="butt"
          transform={`rotate(-90 ${c} ${c})`}
          style={{ transition: reduced ? 'none' : 'stroke-dasharray 900ms linear' }}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center">
        <div className="text-center">{children}</div>
      </div>
    </div>
  );
}
