import { useReducedMotion } from 'framer-motion';

/**
 * Goal progress: a hairline track with an accent fill, the percentage beside
 * it. The fill animates from the left on change (and not at all when Windows
 * has animation effects switched off).
 */
export function GoalBar({
  value,
  goal,
  label,
  compact = false,
}: {
  /** Measured value (minutes or a count). */
  value: number;
  goal: number;
  label: string;
  compact?: boolean;
}) {
  const reduced = useReducedMotion();
  const safeGoal = Math.max(1, goal);
  const ratio = Math.max(0, Math.min(1, value / safeGoal));
  const pct = Math.round(ratio * 100);

  return (
    <div className={compact ? '' : 'mt-1'}>
      <div
        className="relative h-[6px] w-full border border-rule-strong bg-paper-deep"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={safeGoal}
        aria-valuenow={Math.round(Math.min(value, safeGoal))}
        aria-valuetext={`${pct}% of the goal`}
      >
        <div
          className="h-full bg-accent"
          style={{ width: `${pct}%`, transition: reduced ? 'none' : 'width 260ms cubic-bezier(0.16, 0.84, 0.44, 1)' }}
        />
      </div>
    </div>
  );
}
