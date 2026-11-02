import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useAnimationControls, useReducedMotion } from 'framer-motion';
import { IconArrowRight } from '../components/Icons';
import { cleanName, nameError } from '../lib/name';
import { useDispatch } from '../lib/store';

/**
 * The Welcome screen, rebuilt as a title page.
 *
 * This is the first page of a book, not a cover photograph: warm paper, a
 * hairline grid, one very large outlined edition number, and a letterpress
 * seal that turns slowly on the right. The question sits in the left column,
 * the name is written on a ruled line, and the whole page lifts away when the
 * page is set.
 *
 * No image is loaded — the page is entirely type, hairline rules and one SVG
 * seal — so the first thing the app shows costs no network and no decode. The
 * 48px top row remains a drag region and stops clear of the Windows caption
 * buttons.
 *
 * The flow is unchanged in substance: type a name, Enter or click, hear it said
 * back, then Home. Under `prefers-reduced-motion` the entrance is a fade, the
 * seal stops, and the page leaves without travelling.
 */

const FORM_FADE_MS = 280;
const GREETING_MS = 1600;
const GREETING_FADE_MS = 400;
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
      if (!reduced) void shake.start({ x: [0, -9, 9, -6, 6, 0] }, { duration: SHAKE_STEPS * 0.08, ease: 'easeInOut' });
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

  const today = new Date();
  const dateline = today.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
  const year = today.getFullYear();

  const rise = (delay: number) => ({
    initial: reduced ? false : { opacity: 0, y: 16 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.65, delay: reduced ? 0 : delay, ease: EASE },
  });

  return (
    <motion.div
      id="daybook-welcome"
      data-guard="welcome"
      initial={false}
      animate={
        stage === 'leaving'
          ? { opacity: 0, y: reduced ? 0 : -26, scale: reduced ? 1 : 0.992 }
          : { opacity: 1, y: 0, scale: 1 }
      }
      transition={{ duration: GREETING_FADE_MS / 1000, ease: 'easeInOut' }}
      className="welcome grain fixed inset-0 overflow-hidden bg-paper text-ink"
      role="dialog"
      aria-modal="true"
      aria-labelledby="welcome-heading"
    >
      {/* The room: a hairline grid that fades out toward the edges, and one
          very large edition number, outlined rather than filled so it reads as
          an engraving under the type instead of a second headline. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
        <div
          className="absolute inset-0"
          style={{
            backgroundImage:
              'linear-gradient(to right, rgb(var(--rule) / 0.5) 1px, transparent 1px), linear-gradient(to bottom, rgb(var(--rule) / 0.5) 1px, transparent 1px)',
            backgroundSize: 'clamp(48px, 6vw, 92px) clamp(48px, 6vw, 92px)',
            maskImage: 'radial-gradient(ellipse 92% 88% at 34% 38%, black 24%, transparent 100%)',
            WebkitMaskImage: 'radial-gradient(ellipse 92% 88% at 34% 38%, black 24%, transparent 100%)',
          }}
        />
        <div
          className="absolute -left-[12vw] top-[18%] h-[46vw] max-h-[420px] w-[46vw] max-w-[420px] rounded-full opacity-[0.5]"
          style={{ background: 'radial-gradient(circle, rgb(var(--accent) / 0.09) 0%, rgb(var(--accent) / 0) 70%)' }}
        />
      </div>

      <div className="relative z-10 flex h-full flex-col">
        {/* One drag row, exactly as tall as the app header, ending before the
            Windows caption buttons. */}
        <div
          className="drag flex h-12 shrink-0 items-center justify-between pl-6 pr-6"
          style={{ marginRight: '8.75rem' }}
        >
          <div className="flex items-baseline gap-3">
            <span className="font-display text-word font-semibold tracking-tight text-ink">
              Daybook<span className="text-accent">.</span>
            </span>
            <span className="font-mono text-label uppercase tracking-[0.18em] text-ink-mute">First edition</span>
          </div>
          <span className="font-mono text-label uppercase tracking-[0.16em] text-ink-mute">{dateline}</span>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-1 min-[880px]:grid-cols-[minmax(0,1.08fr)_minmax(0,0.92fr)]">
          {/* ------------------------------------------------- left column */}
          <div className="flex min-h-0 flex-col justify-center pb-4 pl-[clamp(24px,6vw,104px)] pr-[clamp(24px,4vw,64px)] pt-4">
            <AnimatePresence mode="wait" initial={false}>
              {stage === 'form' ? (
                <motion.div
                  key="form"
                  initial={false}
                  animate={{ opacity: fading ? 0 : 1, y: fading && !reduced ? -8 : 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: FORM_FADE_MS / 1000, ease: 'easeOut' }}
                  className="w-full max-w-[36rem]"
                >
                  <motion.p
                    {...rise(0.05)}
                    className="font-mono text-label uppercase tracking-[0.26em] text-ink-mute"
                  >
                    A quiet daily ledger
                  </motion.p>

                  <motion.div
                    aria-hidden="true"
                    className="mt-3 h-px w-14 origin-left bg-accent"
                    initial={reduced ? false : { scaleX: 0 }}
                    animate={{ scaleX: 1 }}
                    transition={{ duration: 0.5, delay: reduced ? 0 : 0.18, ease: EASE }}
                  />

                  <motion.h1
                    id="welcome-heading"
                    {...rise(0.16)}
                    className="mt-5 font-display text-[clamp(34px,4.2vw,64px)] font-normal leading-[1.02] tracking-[-0.02em] text-ink"
                  >
                    <span className="block text-balance">What shall we</span>{' '}
                    <span className="mt-1 block text-balance italic text-accent">call you, Knight?</span>
                  </motion.h1>

                  <motion.p {...rise(0.26)} className="mt-5 max-w-[40ch] font-text text-lede text-ink-soft">
                    One name for the masthead. It stays on this computer, with everything else you file here.
                  </motion.p>

                  <motion.form
                    {...rise(0.34)}
                    onSubmit={(event) => {
                      event.preventDefault();
                      submit();
                    }}
                    className="mt-[clamp(20px,4.5vh,40px)] w-full"
                  >
                    <label htmlFor="welcome-name" className="label normal-case tracking-normal">
                      Your name
                    </label>

                    <motion.div animate={shake} className="relative">
                      <div className="welcome-field group relative flex items-end gap-3 border-b-[1.5px] border-ink">
                        <span
                          aria-hidden="true"
                          className="pointer-events-none absolute inset-x-0 -bottom-[2px] h-[1.5px] origin-left scale-x-0 bg-accent transition-transform duration-300 ease-editorial group-focus-within:scale-x-100"
                        />
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
                          className="welcome-name h-[clamp(50px,6vh,62px)] w-full border-0 bg-transparent font-text text-[clamp(21px,2.1vw,28px)] text-ink caret-accent outline-none placeholder:text-ink-mute"
                        />
                        <button
                          type="submit"
                          aria-label="Continue"
                          className="mb-[9px] flex h-11 shrink-0 items-center gap-2 bg-accent px-4 font-text text-small text-accent-ink transition-[background-color,transform] duration-150 hover:bg-accent-deep motion-safe:active:translate-y-px"
                        >
                          Begin
                          <IconArrowRight size={17} strokeWidth={2} />
                        </button>
                      </div>

                      <p
                        id={error ? 'welcome-error' : undefined}
                        role={error ? 'status' : undefined}
                        className={`mt-3 min-h-[1.1rem] font-text text-[13px] leading-tight ${
                          error ? 'text-accent-deep' : 'text-ink-mute'
                        }`}
                      >
                        {error ?? 'Press Enter to begin.'}
                      </p>
                    </motion.div>
                  </motion.form>
                </motion.div>
              ) : (
                <motion.div
                  key="greeting"
                  initial={reduced ? false : { opacity: 0, y: 14 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.35, ease: EASE }}
                  className="w-full max-w-[38rem]"
                >
                  <span className="font-mono text-label uppercase tracking-[0.26em] text-ink-mute">
                    The first page is set
                  </span>
                  <p className="mt-4 font-display text-[clamp(38px,5.4vw,86px)] font-normal leading-[0.98] tracking-[-0.025em] text-ink">
                    Welcome, <span className="italic text-accent">{savedName}</span>.
                  </p>
                  <motion.div
                    aria-hidden="true"
                    className="mt-6 h-px origin-left bg-rule-strong"
                    initial={reduced ? false : { scaleX: 0 }}
                    animate={{ scaleX: 1 }}
                    transition={{ duration: 0.6, delay: reduced ? 0 : 0.15, ease: EASE }}
                  />
                  <p className="mt-3 font-text text-small text-ink-soft">Opening your edition…</p>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* ------------------------------------------------ right column */}
          <div className="relative hidden min-h-0 items-center justify-center border-l border-rule min-[880px]:flex">
            <motion.div
              initial={reduced ? false : { opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.9, delay: reduced ? 0 : 0.3, ease: EASE }}
              className="relative"
            >
              <motion.div
                className="welcome-seal relative"
                style={{ width: 'clamp(196px, 23vw, 314px)', height: 'clamp(196px, 23vw, 314px)' }}
                animate={reduced ? undefined : { rotate: 360 }}
                transition={{ duration: 64, repeat: Infinity, ease: 'linear' }}
              >
                <svg viewBox="0 0 200 200" width="100%" height="100%" role="presentation" aria-hidden="true">
                  <defs>
                    <path
                      id="welcome-seal-path"
                      d="M 100,100 m -76,0 a 76,76 0 1,1 152,0 a 76,76 0 1,1 -152,0"
                    />
                  </defs>
                  <circle cx="100" cy="100" r="94" fill="none" stroke="rgb(var(--rule-strong))" strokeWidth="1" />
                  <circle cx="100" cy="100" r="62" fill="none" stroke="rgb(var(--rule))" strokeWidth="1" />
                  <circle cx="100" cy="100" r="59" fill="none" stroke="rgb(var(--rule))" strokeWidth="1" />
                  <text
                    fill="rgb(var(--ink-mute))"
                    style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '6.6px', letterSpacing: '3.1px' }}
                  >
                    <textPath href="#welcome-seal-path" startOffset="0">
                      DAYBOOK · A QUIET DAILY LEDGER · FOCUS · MOVEMENT · TASKS ·
                    </textPath>
                  </text>
                </svg>
              </motion.div>

              <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
                <div>
                  <p className="font-display text-[clamp(38px,4.4vw,62px)] italic leading-none text-accent">No. 1</p>
                  <p className="mt-3 font-mono text-label uppercase tracking-[0.28em] text-ink-mute">Est. {year}</p>
                </div>
              </div>
            </motion.div>

            <div className="absolute inset-x-[clamp(24px,4vw,64px)] bottom-[clamp(20px,5vh,56px)]">
              <div className="grid grid-cols-3 gap-3 border-t border-rule pt-3">
                {[
                  ['01', 'Focus'],
                  ['02', 'Movement'],
                  ['03', 'Tasks'],
                ].map(([index, label]) => (
                  <motion.div
                    key={label}
                    initial={reduced ? false : { opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5, delay: reduced ? 0 : 0.5 + Number(index) * 0.08, ease: EASE }}
                  >
                    <p className="font-mono text-label tracking-[0.18em] text-ink-mute">{index}</p>
                    <p className="mt-0.5 font-text text-small text-ink-soft">{label}</p>
                  </motion.div>
                ))}
              </div>
            </div>

          </div>
        </div>

        <footer className="relative z-10 flex h-12 shrink-0 items-center justify-between gap-4 border-t border-rule px-6">
          <p className="font-text text-micro text-ink-mute">Everything stays on this computer.</p>
          <p className="hidden font-mono text-label uppercase tracking-[0.14em] text-ink-faint sm:block">
            No account · no network · one file
          </p>
        </footer>
      </div>
    </motion.div>
  );
}
