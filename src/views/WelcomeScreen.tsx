import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useAnimationControls, useReducedMotion } from 'framer-motion';
import { IconArrowRight } from '../components/Icons';
import { LogoMark } from '../components/Logo';
import { WindowControls } from '../components/WindowControls';
import { cleanName, nameError } from '../lib/name';
import { useDispatch } from '../lib/store';

/**
 * The first page, reduced to the only thing it needs: a wordmark, one question,
 * one field. No photograph, no seal, no edition line, no helper copy. The dark
 * rules and numbered ornaments of 1.x are gone; what remains is type and air.
 *
 * The flow is unchanged: type a name, Enter, hear it back, then Home. The 48px
 * top row stays a drag region and stops clear of the Windows caption buttons.
 */

const FORM_FADE_MS = 240;
const GREETING_MS = 1200;
const GREETING_FADE_MS = 320;
const SHAKE_STEPS = 5;

type Stage = 'form' | 'greeting' | 'leaving';

const EASE = [0.16, 0.84, 0.44, 1] as [number, number, number, number];

export function WelcomeScreen({ onDone }: { onDone: () => void }) {
  const dispatch = useDispatch();
  const reduced = useReducedMotion();
  const shake = useAnimationControls();

  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [stage, setStage] = useState<Stage>('form');
  const [fading, setFading] = useState(false);
  const [savedName, setSavedName] = useState('');

  const inputRef = useRef<HTMLInputElement>(null);
  const timers = useRef<number[]>([]);

  const later = useCallback((fn: () => void, ms: number) => {
    timers.current.push(window.setTimeout(fn, ms));
  }, []);

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach((id) => window.clearTimeout(id));
  }, []);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const submit = useCallback(() => {
    const name = cleanName(value);
    const problem = nameError(name);
    if (problem) {
      setError(problem);
      inputRef.current?.focus();
      if (!reduced) void shake.start({ x: [0, -7, 7, -4, 4, 0] }, { duration: SHAKE_STEPS * 0.07, ease: 'easeInOut' });
      return;
    }
    setError(null);
    setSavedName(name);
    dispatch({ type: 'profile/set-name', name });
    setFading(true);
    later(() => setStage('greeting'), reduced ? 0 : FORM_FADE_MS);
  }, [dispatch, later, reduced, shake, value]);

  useEffect(() => {
    if (stage !== 'greeting') return;
    let finished = false;
    const leave = () => {
      if (finished) return;
      finished = true;
      setStage('leaving');
      later(onDone, reduced ? 0 : GREETING_FADE_MS);
    };
    const timer = window.setTimeout(leave, GREETING_MS);
    window.addEventListener('keydown', leave);
    window.addEventListener('pointerdown', leave);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('keydown', leave);
      window.removeEventListener('pointerdown', leave);
    };
  }, [later, onDone, reduced, stage]);

  const rise = (delay: number) => ({
    initial: reduced ? false : { opacity: 0, y: 12 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.5, delay: reduced ? 0 : delay, ease: EASE },
  });

  return (
    <motion.div
      id="daybook-welcome"
      data-guard="welcome"
      initial={false}
      animate={
        stage === 'leaving'
          ? { opacity: 0, y: reduced ? 0 : -18 }
          : { opacity: 1, y: 0 }
      }
      transition={{ duration: GREETING_FADE_MS / 1000, ease: 'easeInOut' }}
      className="welcome fixed inset-0 overflow-hidden bg-paper text-ink"
      role="dialog"
      aria-modal="true"
      aria-labelledby="welcome-heading"
    >
      <WindowControls />

      {/* The mark appears four times behind the page: large and soft at the
          edges, smaller through the middle. It is brand weather, not content. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
        <LogoMark className="absolute -right-[10%] -top-[18%] h-[38rem] -rotate-12 text-[#001766] opacity-[0.07] blur-[22px]" />
        <LogoMark className="absolute -left-[16%] top-[28%] h-[30rem] -rotate-[18deg] text-[#001766] opacity-[0.055] blur-[16px]" />
        <LogoMark className="absolute -bottom-[24%] right-[22%] h-[26rem] rotate-[15deg] text-[#001766] opacity-[0.05] blur-[12px]" />
        <LogoMark className="absolute left-[44%] top-[6%] h-[12rem] rotate-[8deg] text-[#001766] opacity-[0.045] blur-[7px]" />
      </div>

      <div className="relative z-10 flex h-full flex-col">
        <div className="drag flex h-12 shrink-0 items-center gap-2.5 pl-6" style={{ marginRight: '8.75rem' }}>
          <LogoMark className="h-6 text-[#001766]" />
          <span className="font-display text-word font-semibold tracking-[-0.02em] text-ink">
            Daybook<span className="text-accent">.</span>
          </span>
        </div>

        <div className="flex min-h-0 flex-1 items-center justify-center px-6 pb-8">
          <div className="w-full max-w-[36rem]">
            <AnimatePresence mode="wait" initial={false}>
              {stage === 'form' ? (
                <motion.div
                  key="form"
                  initial={false}
                  animate={{ opacity: fading ? 0 : 1, y: fading && !reduced ? -6 : 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: FORM_FADE_MS / 1000, ease: 'easeOut' }}
                >
                  <motion.h1
                    id="welcome-heading"
                    {...rise(0.04)}
                    className="max-w-[11ch] font-display text-[clamp(38px,4.6vw,56px)] font-semibold leading-[1.02] tracking-[-0.04em] text-balance text-ink"
                  >
                    What should we call you?
                  </motion.h1>

                  <motion.form
                    {...rise(0.12)}
                    onSubmit={(event) => {
                      event.preventDefault();
                      submit();
                    }}
                    className="mt-[clamp(28px,6vh,56px)]"
                  >
                    <motion.div animate={shake}>
                      <div className="welcome-field flex items-center gap-2 rounded-[12px] border border-rule-strong bg-paper-raise p-1.5 transition-[border-color,box-shadow] duration-150 focus-within:border-accent">
                        <input
                          ref={inputRef}
                          id="welcome-name"
                          autoFocus
                          value={value}
                          onChange={(event) => {
                            setValue(event.target.value);
                            if (error) setError(null);
                          }}
                          onKeyDown={(event) => {
                            if (event.key !== 'Enter') return;
                            event.preventDefault();
                            submit();
                          }}
                          aria-label="Your name"
                          aria-invalid={error ? true : undefined}
                          aria-describedby={error ? 'welcome-error' : undefined}
                          autoComplete="off"
                          spellCheck={false}
                          maxLength={48}
                          placeholder="Your name"
                          className="h-11 min-w-0 flex-1 border-0 bg-transparent px-3 font-text text-[17px] text-ink caret-accent outline-none placeholder:text-ink-mute"
                        />
                        <button
                          type="submit"
                          aria-label="Continue"
                          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[9px] bg-accent text-accent-ink transition-[background-color,transform] duration-150 hover:bg-accent-deep motion-safe:active:translate-y-px"
                        >
                          <IconArrowRight size={17} strokeWidth={2} />
                        </button>
                      </div>

                      <p
                        id={error ? 'welcome-error' : undefined}
                        role={error ? 'status' : undefined}
                        className={`mt-3 min-h-[1.1rem] font-text text-[13px] leading-tight ${
                          error ? 'text-accent-deep' : 'text-transparent'
                        }`}
                      >
                        {error ?? '\u00a0'}
                      </p>
                    </motion.div>
                  </motion.form>
                </motion.div>
              ) : (
                <motion.div
                  key="greeting"
                  id="welcome-greeting"
                  initial={reduced ? false : { opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, ease: EASE }}
                  className="text-center"
                >
                  <p className="font-display text-[clamp(36px,4.8vw,58px)] font-semibold leading-[1.02] tracking-[-0.04em] text-ink">
                    Welcome, <span className="text-accent">{savedName}</span>.
                  </p>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
