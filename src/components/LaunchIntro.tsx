import { useCallback, useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { LogoMark } from './Logo';
import { WindowControls } from './WindowControls';

const EASE = [0.16, 0.84, 0.44, 1] as [number, number, number, number];

const LINES = [
  'What’s the goal today?',
  'One clear thing first.',
  'Make a little room for the work that matters.',
  'Start where you are. The page is open.',
  'A small, honest beginning is enough.',
];

/**
 * The short welcome that plays over Home on every launch: the name, a question
 * and one quiet line. It leaves on its own, or the moment the owner clicks or
 * presses a key. The first-run Welcome screen already does the introduction, so
 * this is deliberately skipped there.
 */
export function LaunchIntro({ name, onDone }: { name: string; onDone: () => void }) {
  const reduced = useReducedMotion();
  const [leaving, setLeaving] = useState(false);
  const done = useRef(false);
  const timers = useRef<number[]>([]);

  const leave = useCallback(() => {
    if (done.current) return;
    done.current = true;
    setLeaving(true);
    timers.current.push(window.setTimeout(onDone, reduced ? 0 : 280));
  }, [onDone, reduced]);

  useEffect(() => {
    const id = window.setTimeout(leave, reduced ? 700 : 1900);
    window.addEventListener('pointerdown', leave);
    window.addEventListener('keydown', leave);
    return () => {
      window.clearTimeout(id);
      timers.current.forEach((timer) => window.clearTimeout(timer));
      window.removeEventListener('pointerdown', leave);
      window.removeEventListener('keydown', leave);
    };
  }, [leave]);

  const hour = new Date().getHours();
  const hello = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const line = LINES[new Date().getDate() % LINES.length];

  return (
    <motion.div
      data-launch-intro="true"
      initial={false}
      animate={{ opacity: leaving ? 0 : 1 }}
      transition={{ duration: 0.28, ease: 'easeInOut' }}
      className="welcome fixed inset-0 z-[80] overflow-hidden bg-paper text-ink"
      role="status"
      aria-live="polite"
    >
      <WindowControls />
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
        <LogoMark className="absolute -right-[8%] -top-[20%] h-[34rem] -rotate-12 text-[#001766] opacity-[0.055] blur-[18px]" />
        <LogoMark className="absolute -bottom-[26%] left-[12%] h-[28rem] rotate-[14deg] text-[#001766] opacity-[0.045] blur-[14px]" />
      </div>

      <div className="relative z-10 flex h-full items-center justify-center px-8">
        <motion.div
          className="w-full max-w-[42rem]"
          initial={reduced ? false : { opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.42, ease: EASE }}
        >
          <div className="flex items-center gap-3">
            <LogoMark className="h-7 text-[#001766]" />
            <span className="font-text text-micro text-ink-mute">{hello}</span>
          </div>
          <h1 className="mt-5 max-w-[13ch] font-display text-[clamp(38px,5vw,64px)] font-semibold leading-[0.98] tracking-[-0.04em] text-balance">
            Welcome back, <span className="text-accent">{name}</span>.
          </h1>
          <div className="mt-5 flex items-center gap-3">
            <span aria-hidden="true" className="h-px w-10 bg-accent" />
            <p className="font-text text-body text-ink-soft">{line}</p>
          </div>
        </motion.div>
      </div>
    </motion.div>
  );
}
