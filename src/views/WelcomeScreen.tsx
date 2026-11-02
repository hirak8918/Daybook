import { useCallback, useEffect, useRef, useState } from 'react';
import { motion, useAnimationControls, useReducedMotion } from 'framer-motion';
import hills from '../assets/onboarding/welcome-hills.webp';
import forest from '../assets/onboarding/welcome-forest.webp';
import knight from '../assets/onboarding/welcome-bg.webp';
import { AsciiSun } from '../components/AsciiArt';
import { IconArrowRight } from '../components/Icons';
import { cleanName, nameError } from '../lib/name';
import { useDispatch } from '../lib/store';

/**
 * The Welcome screen — the one question Daybook asks before it starts.
 *
 * A full-window layer above the shell (the 48px header and the tabs are not
 * drawn while it is up), never scrolling, ending by itself: name → a beat of
 * acknowledgement → Home. There is no skip button, because nothing is being
 * asked that the app can proceed without.
 *
 * The composition is deliberately asymmetric: the words sit in the calm, shaded
 * left third, the photograph carries the right, and an engraved ASCII sun sits
 * over the sky where the light already is. The three plates cross-fade every
 * eight seconds — slowly enough to feel like weather rather than a slideshow.
 */

/** How long the acknowledgement stays on screen before Home fades in. */
const GREETING_MS = 1600;
/** Steps in the shake, each this long — the brief's 80 ms figure. */
const SHAKE_STEPS = 5;
const FORM_FADE_MS = 300;
const GREETING_FADE_MS = 400;
const IMAGE_FADE_MS = 300;
/** One plate's turn on screen, and the cross-fade between plates. */
const PLATE_MS = 8000;
const PLATE_FADE_MS = 1200;

type Stage = 'form' | 'greeting' | 'leaving';

const PLATES = [
  { src: hills, alt: 'Layered hills under a gold dusk haze' },
  { src: forest, alt: 'A forest ridge catching the last of the sun' },
  { src: knight, alt: 'An armoured knight resting in a field of orange wildflowers' },
];

/**
 * Two gradients, both doing a job: the horizontal one gives the left column a
 * floor to sit on at any window width, the radial one closes the corners. The
 * photograph is never tinted or washed — only the edges are held down.
 */
const LEFT_SHADE =
  'linear-gradient(90deg, rgba(8, 7, 6, 0.94) 0%, rgba(8, 7, 6, 0.86) 26%, rgba(8, 7, 6, 0.46) 50%, rgba(8, 7, 6, 0.06) 72%, rgba(8, 7, 6, 0) 100%)';
const VIGNETTE = 'radial-gradient(ellipse 100% 88% at 52% 48%, rgba(0, 0, 0, 0) 42%, rgba(0, 0, 0, 0.38) 100%)';
const FOOT_SHADE = 'linear-gradient(0deg, rgba(8, 7, 6, 0.72) 0%, rgba(8, 7, 6, 0.22) 14%, rgba(8, 7, 6, 0) 30%)';

export function WelcomeScreen({ onDone }: { onDone: () => void }) {
  const dispatch = useDispatch();
  const reduced = useReducedMotion();
  const shake = useAnimationControls();

  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [stage, setStage] = useState<Stage>('form');
  const [fading, setFading] = useState(false);
  const [savedName, setSavedName] = useState('');
  const [plate, setPlate] = useState(0);
  const [loaded, setLoaded] = useState<boolean[]>([false, false, false]);

  const inputRef = useRef<HTMLInputElement>(null);
  const timers = useRef<number[]>([]);

  const later = useCallback((fn: () => void, ms: number) => {
    timers.current.push(window.setTimeout(fn, ms));
  }, []);

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach((id) => window.clearTimeout(id));
  }, []);

  // The plates swap places; the picture is never redrawn, moved or zoomed.
  // Under reduced motion the first plate simply stays.
  useEffect(() => {
    if (reduced) return;
    const id = window.setInterval(() => {
      if (document.visibilityState === 'hidden') return;
      setPlate((current) => (current + 1) % PLATES.length);
    }, PLATE_MS);
    return () => window.clearInterval(id);
  }, [reduced]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const markLoaded = (index: number) =>
    setLoaded((current) => (current[index] ? current : current.map((flag, i) => (i === index ? true : flag))));

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
      {/* #0B0908 shows until the first plate has decoded, then it fades in. */}
      {PLATES.map((entry, index) => (
        <img
          key={entry.src}
          src={entry.src}
          alt=""
          aria-hidden="true"
          draggable={false}
          onLoad={() => markLoaded(index)}
          data-plate={index}
          className="pointer-events-none absolute inset-0 h-full w-full select-none object-cover"
          style={{
            objectPosition: '50% 42%',
            opacity: loaded[index] && index === plate ? 1 : 0,
            transitionProperty: 'opacity',
            transitionTimingFunction: 'ease-in-out',
            transitionDuration: `${index === 0 ? IMAGE_FADE_MS : PLATE_FADE_MS}ms`,
          }}
        />
      ))}

      {/* A single scrim over every plate keeps the three photographs in the
          same key — the forest plate is much brighter than the others — and it
          is what lets the cream type keep one contrast ratio all cycle long. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[rgba(8,7,6,0.16)]" />
      <div aria-hidden="true" className="pointer-events-none absolute inset-0" style={{ background: LEFT_SHADE }} />
      <div aria-hidden="true" className="pointer-events-none absolute inset-0" style={{ background: VIGNETTE }} />
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 h-1/3" style={{ background: FOOT_SHADE }} />

      {/* The sun is the same on every plate, so it reads as part of the room
          rather than as an effect on a particular photograph. It is clipped by
          its own frame: decoration must never be able to grow a scrollbar. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
        <AsciiSun
          className="absolute right-[2vw] top-[clamp(44px,7vh,104px)] text-[clamp(7px,0.82vw,13px)] mix-blend-screen transition-opacity duration-700"
          // The knight fills the frame, so the engraving steps back rather than
          // printing itself across his armour.
          opacity={plate === 2 ? 0.16 : reduced ? 0.38 : 0.46}
        />
      </div>

      {stage === 'form' ? (
        <motion.div
          initial={false}
          animate={{ opacity: fading ? 0 : 1 }}
          transition={{ duration: FORM_FADE_MS / 1000, ease: 'easeOut' }}
          className="absolute inset-0"
        >
          <div className="flex h-full flex-col justify-center pb-[8vh] pl-[clamp(24px,7vw,120px)] pr-[clamp(24px,6vw,96px)] pt-12">
            <div className="w-[min(36rem,54vw)] max-[860px]:w-[min(30rem,80vw)]">
              <p className="font-mono text-label uppercase tracking-[0.26em] text-[rgb(var(--cream)/0.7)]">Daybook</p>
              <span aria-hidden="true" className="mt-3 block h-px w-12 bg-accent" />

              <h1
                id="welcome-heading"
                className="mt-5 font-display text-[clamp(30px,3.5vw,52px)] font-normal leading-[1.08] tracking-[-0.01em]"
                style={{ color: 'rgb(var(--cream))' }}
              >
                <span className="block text-balance">What shall we call you,</span>{' '}
                <span className="block text-accent">Knight?</span>
              </h1>

              <div className="mt-8" style={{ width: 'clamp(340px, 34vw, 520px)' }}>
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
                      className="welcome-note absolute inset-x-0 top-full mt-3 font-text text-[13px] leading-tight"
                    >
                      {error}
                    </p>
                  ) : null}
                </motion.div>
              </div>
            </div>
          </div>

          <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-6 px-[clamp(24px,7vw,120px)] pb-8 pr-[clamp(24px,7vw,120px)]">
            <p className="font-mono text-[12px] leading-none text-[rgb(var(--cream)/0.72)]">
              Everything stays on this computer.
            </p>
            <div aria-hidden="true" className="flex items-center gap-1.5">
              {PLATES.map((entry, index) => (
                <span
                  key={entry.src}
                  className="block h-1 w-1 rounded-full transition-colors duration-500"
                  style={{ background: index === plate ? 'rgb(var(--accent))' : 'rgba(244, 239, 230, 0.35)' }}
                />
              ))}
            </div>
          </div>
        </motion.div>
      ) : (
        <div className="absolute inset-0 flex items-center pl-[clamp(24px,7vw,120px)] pr-[clamp(24px,6vw,96px)]">
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.25 }}
            className="max-w-[24ch] font-display text-[clamp(32px,4vw,60px)] font-normal leading-[1.05]"
            style={{ color: 'rgb(var(--cream))' }}
          >
            Welcome, <span className="text-accent">{savedName}</span>.
          </motion.p>
        </div>
      )}

      {/* The top 48px drags the window, exactly as the header row does. It stops
          short of the caption buttons, which Windows draws and must keep. */}
      <div aria-hidden="true" className="drag absolute left-0 right-[8.75rem] top-0 h-12" />
    </motion.div>
  );
}
