import { motion, useReducedMotion } from 'framer-motion';

/**
 * Odometer — each digit lives on its own vertical strip and rolls to the new
 * value. Non-digit characters (colons, spaces, "h", "m") are rendered as plain
 * text so the layout is driven by the real font, not by a guess.
 *
 * Under `prefers-reduced-motion` the roll is replaced by a plain swap.
 */
export function Odometer({ value, className }: { value: string; className?: string }) {
  const reduced = useReducedMotion();
  const chars = [...value];
  return (
    <span className={className} role="text" aria-label={value}>
      {chars.map((char, i) =>
        /\d/.test(char) && !reduced ? (
          <Digit key={`${i}-${char}`} char={Number(char)} />
        ) : (
          <span key={`${i}-${char}`} aria-hidden>
            {char}
          </span>
        ),
      )}
    </span>
  );
}

function Digit({ char }: { char: number }) {
  return (
    <span
      aria-hidden
      className="relative inline-block overflow-hidden align-baseline"
      style={{ height: '1em', width: '1ch' }}
    >
      <motion.span
        className="absolute inset-x-0 top-0 flex flex-col items-center"
        initial={false}
        animate={{ y: `${-char * 10}%` }}
        transition={{ type: 'spring', stiffness: 420, damping: 34, mass: 0.7 }}
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
