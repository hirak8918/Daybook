import { motion, useReducedMotion } from 'framer-motion';
import type { ReactNode } from 'react';

/**
 * The timer dial.
 *
 * A minute rim of sixty ticks, a hairline track and one accent arc. The arc
 * ends in a small travelling head, and while a session runs a single dot walks
 * the rim once a minute — the clock's second hand, moved out of the way of the
 * digits. Nothing else moves: the numbers are the instrument.
 *
 * Every animation is gated on `prefers-reduced-motion`; the dial still reports
 * progress, it simply stops travelling.
 */
export function TimerRing({
  progress,
  size = 320,
  label,
  running = false,
  children,
}: {
  progress: number;
  size?: number;
  label?: string;
  running?: boolean;
  children?: ReactNode;
}) {
  const reduced = useReducedMotion();
  const c = size / 2;
  const arcR = c - 24;
  const rimOuter = c - 6;
  const pct = Math.max(0, Math.min(1, progress));
  const angle = pct * 360 - 90;
  const headX = c + Math.cos((angle * Math.PI) / 180) * arcR;
  const headY = c + Math.sin((angle * Math.PI) / 180) * arcR;

  const ticks = Array.from({ length: 60 }, (_, i) => {
    const a = (i / 60) * Math.PI * 2 - Math.PI / 2;
    const major = i % 5 === 0;
    const inner = rimOuter - (major ? 9 : 4.5);
    return {
      i,
      major,
      x1: c + Math.cos(a) * rimOuter,
      y1: c + Math.sin(a) * rimOuter,
      x2: c + Math.cos(a) * inner,
      y2: c + Math.sin(a) * inner,
      lit: i / 60 <= pct,
    };
  });

  return (
    <div className="relative" style={{ width: size, height: size }}>
      {/* A quiet bloom while the session runs, so a paused dial looks paused at
          a glance. It never sits above the type. */}
      {running && !reduced ? (
        <motion.span
          aria-hidden="true"
          className="pointer-events-none absolute inset-[14%] rounded-full"
          style={{ background: 'radial-gradient(circle, rgb(var(--accent) / 0.18) 0%, rgb(var(--accent) / 0) 70%)' }}
          animate={{ opacity: [0.45, 0.9, 0.45], scale: [0.97, 1.02, 0.97] }}
          transition={{ duration: 4.6, repeat: Infinity, ease: 'easeInOut' }}
        />
      ) : null}

      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-label={label}
        className="relative block"
      >
        {/* Rim: the full minute, with every fifth tick longer and darker. Ticks
            behind the elapsed arc pick up the accent. */}
        {ticks.map((tick) => (
          <line
            key={tick.i}
            x1={tick.x1}
            y1={tick.y1}
            x2={tick.x2}
            y2={tick.y2}
            stroke="rgb(var(--rule-strong))"
            strokeWidth={tick.major ? 1.2 : 0.75}
            opacity={tick.lit ? 0.95 : tick.major ? 0.75 : 0.45}
            style={
              tick.lit
                ? { stroke: 'rgb(var(--accent))', transition: reduced ? 'none' : 'stroke 400ms linear, opacity 400ms linear' }
                : { transition: reduced ? 'none' : 'stroke 400ms linear, opacity 400ms linear' }
            }
          />
        ))}

        <circle cx={c} cy={c} r={arcR} fill="none" stroke="rgb(var(--rule-strong))" strokeWidth={1} opacity={0.8} />
        <circle
          cx={c}
          cy={c}
          r={arcR}
          fill="none"
          stroke="rgb(var(--accent))"
          strokeWidth={2.5}
          pathLength={100}
          strokeDasharray={`${pct * 100} 100`}
          strokeLinecap="butt"
          transform={`rotate(-90 ${c} ${c})`}
          style={{ transition: reduced ? 'none' : 'stroke-dasharray 900ms linear' }}
        />

        {/* The head of the arc. It moves with the same easing as the arc, so
            the two never disagree by a frame. */}
        <motion.circle
          r={3}
          fill="rgb(var(--accent))"
          initial={false}
          animate={{ cx: headX, cy: headY }}
          transition={{ duration: reduced ? 0 : 0.9, ease: 'linear' }}
        />

        {/* The rim dot: one lap a minute, only while the session runs. */}
        {running && !reduced ? (
          <motion.g
            style={{ transformOrigin: `${c}px ${c}px` }}
            animate={{ rotate: 360 }}
            transition={{ duration: 60, repeat: Infinity, ease: 'linear' }}
          >
            <circle cx={c} cy={c - rimOuter + 1} r={1.7} fill="rgb(var(--accent))" opacity={0.85} />
          </motion.g>
        ) : null}
      </svg>

      <div className="absolute inset-0 grid place-items-center">
        <div className="text-center">{children}</div>
      </div>
    </div>
  );
}
