import { useCallback, useEffect, useRef, useState } from 'react';
import { motion, useAnimationControls, useReducedMotion } from 'framer-motion';
import background from '../assets/onboarding/welcome-bg.webp';
import { IconArrowRight } from '../components/Icons';
import { cleanName, nameError } from '../lib/name';
import { useDispatch } from '../lib/store';

/**
 * The Welcome screen — the one question Daybook asks before it starts.
 *
 * It is a full-window layer above the shell (the 48px header and the tabs are
 * not drawn while it is up), it never scrolls, and it ends by itself: name →
 * a beat of acknowledgement → Home. There is no skip button, because nothing is
 * being asked that the app can proceed without.
 *
 * The whole flow is one component with three stages rather than a router: the
 * transition is the feature, and each step has a fixed duration the tests can
 * measure.
 */

/** How long the acknowledgement stays on screen before Home fades in. */
const GREETING_MS = 1600;
/** Steps in the shake, each this long — the brief's 80 ms figure. */
const SHAKE_STEPS = 5;
const FORM_FADE_MS = 300;
const GREETING_FADE_MS = 400;
const IMAGE_FADE_MS = 300;

/**
 * The vignette. Transparent across the middle where the words are, no more than
 * 35% black at the corners: it protects the text without tinting the photo.
 */
const VIGNETTE = 'radial-gradient(ellipse 96% 82% at 50% 46%, rgba(0, 0, 0, 0) 38%, rgba(0, 0, 0, 0.35) 100%)';

type Stage = 'form' | 'greeting' | 'leaving';

export function WelcomeScreen({ onDone }: { onDone: () => void }) {
  const dispatch = useDispatch();
  const reduced = useReducedMotion();
  const shake = useAnimationControls();

  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [stage, setStage] = useState<Stage>('form');
  const [fading, setFading] = useState(false);
  const [imageIn, setImageIn] = useState(false);
  const [savedName, setSavedName] = useState('');

  const inputRef = useRef<HTMLInputElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const timers = useRef<number[]>([]);

  const later = useCallback((fn: () => void, ms: number) => {
    timers.current.push(window.setTimeout(fn, ms));
  }, []);

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach((id) => window.clearTimeout(id));
  }, []);

  // The photo is usually already in the asar cache, in which case `onLoad`
  // fired before React attached and would never arrive again.
  useEffect(() => {
    if (imageRef.current?.complete) setImageIn(true);
    inputRef.current?.focus();
  }, []);

  const submit = useCallback(() => {
    const name = cleanName(value);
    const problem = nameError(name);
    if (problem) {
      // Keep the caret where it is — the field is the only place to fix this.
      setError(problem);
      inputRef.current?.focus();
      if (!reduced) void shake.start({ x: [0, -8, 8, -6, 6, 0] }, { duration: SHAKE_STEPS * 0.08, ease: 'easeInOut' });
      return;
    }
    setError(null);
    setSavedName(name);
    dispatch({ type: 'profile/set-name', name });
    setFading(true);
    later(() => setStage('greeting'), reduced ? 0 : FORM_FADE_MS);
  }, [dispatch, later, reduced, shake, value]);

  // The acknowledgement: a fixed beat, skippable by any key or click.
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

  return (
    <motion.div
      id="daybook-welcome"
      data-guard="welcome"
      initial={false}
      animate={{ opacity: stage === 'leaving' ? 0 : 1 }}
      transition={{ duration: GREETING_FADE_MS / 1000, ease: 'easeInOut' }}
      className="welcome fixed inset-0 overflow-hidden bg-[#0B0908]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="welcome-heading"
    >
      {/* #0B0908 shows until the photograph has decoded, then it fades in over
          it. object-position keeps the knight's helmet in the upper right. */}
      <img
        ref={imageRef}
        src={background}
        alt=""
        aria-hidden="true"
        draggable={false}
        onLoad={() => setImageIn(true)}
        className="pointer-events-none absolute inset-0 h-full w-full select-none object-cover transition-opacity ease-out"
        style={{
          objectPosition: '50% 40%',
          opacity: imageIn ? 1 : 0,
          transitionDuration: `${IMAGE_FADE_MS}ms`,
        }}
      />

      <div aria-hidden="true" className="pointer-events-none absolute inset-0" style={{ background: VIGNETTE }} />

      {stage === 'form' ? (
        <motion.div
          initial={false}
          animate={{ opacity: fading ? 0 : 1 }}
          transition={{ duration: FORM_FADE_MS / 1000, ease: 'easeOut' }}
          className="absolute inset-0"
        >
          {/* The heading's centre sits on the 50% line at every window size. */}
          <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 px-5">
            <h1
              id="welcome-heading"
              className="mx-auto max-w-[90vw] text-balance text-center font-display text-[clamp(28px,2.8vw,44px)] font-normal leading-[1.18]"
            >
              <span style={{ color: 'rgb(var(--cream))' }}>What shall we call you,</span>{' '}
              <span className="text-accent">Knight?</span>
            </h1>
          </div>

          {/* …and the field's centre on the 58% line. On a short window the two
              would collide, so the gap has a floor: whichever is lower wins. */}
          <div className="absolute inset-x-0" style={{ top: 'max(58%, calc(50% + 4.5rem))' }}>
            <div className="mx-auto -translate-y-1/2" style={{ width: 'clamp(340px, 36vw, 560px)' }}>
              <motion.div animate={shake} className="relative">
                <div
                  className="welcome-pill relative flex items-center rounded-[17px] border-[1.5px] border-accent backdrop-blur-sm"
                  style={{ height: 'clamp(64px, 6.6vh, 70px)', background: 'rgba(10, 8, 7, 0.88)' }}
                >
                  <input
                    ref={inputRef}
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
                    // Long enough to type past the limit and be told, rather
                    // than silently truncated at the boundary.
                    maxLength={48}
                    className="h-full w-full rounded-[17px] border-0 bg-transparent pl-6 pr-[4.5rem] font-text text-[20px] text-[rgb(var(--cream))] caret-accent outline-none"
                  />
                  <button
                    type="button"
                    onClick={submit}
                    aria-label="Continue"
                    className="absolute right-[10px] top-1/2 grid h-12 w-12 -translate-y-1/2 place-items-center rounded-full bg-accent text-white transition-colors duration-150 hover:bg-accent-deep motion-safe:active:scale-[0.96]"
                  >
                    <IconArrowRight size={22} strokeWidth={2} />
                  </button>
                </div>

                {/* Absolutely placed, so the help line never moves the field. */}
                {error ? (
                  <p
                    id="welcome-error"
                    role="status"
                    className="welcome-note absolute inset-x-0 top-full mt-3 text-center font-text text-[13px] leading-tight"
                  >
                    {error}
                  </p>
                ) : null}
              </motion.div>
            </div>
          </div>
        </motion.div>
      ) : (
        <div className="absolute inset-0 grid place-items-center px-5">
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.25 }}
            className="text-center font-display text-[clamp(28px,2.8vw,44px)] font-normal leading-[1.18]"
            style={{ color: 'rgb(var(--cream))' }}
          >
            Welcome, {savedName}.
          </motion.p>
        </div>
      )}

      {/* The top 48px drags the window, exactly as the header row does. It stops
          short of the caption buttons, which Windows draws and must keep. */}
      <div aria-hidden="true" className="drag absolute left-0 right-[8.75rem] top-0 h-12" />
    </motion.div>
  );
}
