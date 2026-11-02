import { motion, useReducedMotion } from 'framer-motion';

/**
 * Odometer — each digit lives on its own vertical strip and rolls to the new
 * value. Non-digit characters (colons, spaces, "h", "m") are rendered as plain
 * text so the layout is driven by the real font, not by a guess.
 *
 * The strip is keyed by position rather than by character, which is what makes
 * the roll continuous: 09:59 → 10:00 rolls four digits instead of remounting
 * them. A soft mask fades the top and bottom of each window so the digits below
 * and above do not print through the line.
 *
 * The colon is the clock's second hand: it fades once a second while a session
 * runs and holds steady when it does not. Under `prefers-reduced-motion` both
 * the roll and the blink are replaced by plain swaps.
 */
export function Odometer({
  value,
  className,
  running = false,
}: {
  value: string;
  className?: string;
  running?: boolean;
}) {
  const reduced = useReducedMotion();
  const chars = [...value];

  return (
    <span className={className} role="timer" aria-label={value}>
      {chars.map((char, i) => {
        if (/[0-9]/.test(char) && !reduced) return <Digit key={i} char={Number(char)} />;
        if (char === ':') return <Colon key={i} running={running && !reduced} />;
        return (
          <span key={i} aria-hidden="true">
            {char}
          </span>
        );
      })}
    </span>
  );
}

function Colon({ running }: { running: boolean }) {
  return (
    <motion.span
      aria-hidden="true"
      className="inline-block"
      initial={false}
      animate={running ? { opacity: [1, 0.22, 1] } : { opacity: 1 }}
      transition={running ? { duration: 1, repeat: Infinity, ease: 'easeInOut' } : { duration: 0.2 }}
    >
      :
    </motion.span>
  );
}

function Digit({ char }: { char: number }) {
  return (
    <span
      aria-hidden="true"
      className="relative inline-block overflow-hidden align-baseline"
      style={{
        height: '1em',
        width: '1ch',
        WebkitMaskImage:
          'linear-gradient(to bottom, transparent 0%, black 12%, black 88%, transparent 100%)',
        maskImage: 'linear-gradient(to bottom, transparent 0%, black 12%, black 88%, transparent 100%)',
      }}
    >
      <motion.span
        className="absolute inset-x-0 top-0 flex flex-col items-center"
        initial={false}
        animate={{ y: `${-char * 10}%` }}
        transition={{ type: 'spring', stiffness: 380, damping: 32, mass: 0.62 }}
        style={{ height: '10em' }}
      >
        {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => (
          <span key={d} style={{ height: '1em', lineHeight: 1 }}>
            {d}
          </span>
        ))}
      </motion.span>
    </span>
  );
}
