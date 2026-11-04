import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { DaybookStore, StoreContext, useBoot, useDark, useSelect, useStoreApi } from './lib/store';
import { AppSidebar, PageBar, type TabId } from './components/AppHeader';
import { LogoMark } from './components/Logo';
import { WindowControls } from './components/WindowControls';
import { WelcomeScreen } from './views/WelcomeScreen';
import { NoticeStack, type Notice } from './components/Overlays';
import { DayDialog } from './components/DayDialog';
import { HomeView } from './views/HomeView';
import { TimerView } from './views/TimerView';
import { ActivityView } from './views/ActivityView';
import { SettingsView } from './views/SettingsView';
import { useHotkeys, type HotkeyMap } from './hooks/useHotkeys';
import { playChime } from './lib/audio';
import type { BridgeSignal } from './lib/ipc';
import type { DateKey } from './lib/date';

/**
 * The shell. One window, a fixed left rail, one page title row, four sections,
 * and a content area that is exactly the rest of the viewport. The only
 * scrollable things in the app are a long note and the two dialogs that have
 * always scrolled on purpose.
 */
export function App() {
  const store = useMemo(() => new DaybookStore(), []);
  return (
    <StoreContext.Provider value={store}>
      <Shell />
    </StoreContext.Provider>
  );
}

function Shell() {
  const store = useStoreApi();
  const [ready, setReady] = useState(false);
  const [bootError, setBootError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabId>('home');
  const [fullscreen, setFullscreen] = useState(false);
  const [day, setDay] = useState<DateKey | null>(null);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [welcomeDone, setWelcomeDone] = useState(false);

  const boot = useBoot();
  // A name is all the Welcome screen is waiting for, so subscribe to just that:
  // the shell must not repaint every time the timer ticks.
  const profileName = useSelect((data) => data.profile?.name ?? '');

  const pushNotice = useCallback((notice: Omit<Notice, 'id'>) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setNotices((list) => [...list.slice(-3), { ...notice, id }]);
    const ttl = notice.actionLabel ? 5000 : 4500;
    window.setTimeout(() => setNotices((list) => list.filter((n) => n.id !== id)), ttl);
  }, []);

  /* ------------------------------------------------ boot */
  useEffect(() => {
    let cancelled = false;
    store
      .init()
      .then(() => {
        if (!cancelled) setReady(true);
      })
      .catch((err: Error) => {
        if (!cancelled) setBootError(err.message);
      });
    return () => {
      cancelled = true;
      store.dispose();
    };
  }, [store]);

  /* ------------------------------------------------ theme */
  const dark = useDark();
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
  }, [dark]);

  /* ------------------------------------------------ main-process signals */
  useEffect(() => {
    return store.subscribeSignal((signal: BridgeSignal) => {
      const settings = store.getData().settings;
      if (signal.kind === 'sessionComplete') {
        if (settings.pomodoro.chimeSound) playChime();
        pushNotice({
          tone: 'good',
          title: 'Session logged',
          body: `${signal.info.minutes} min of ${signal.info.tag} added to today's focus time.`,
        });
      } else if (signal.kind === 'breakComplete') {
        if (settings.pomodoro.chimeSound) playChime();
        pushNotice({ tone: 'info', title: 'Break over', body: 'Ready to focus again when you are.' });
      } else if (signal.kind === 'shortcutFailed') {
        pushNotice({ tone: 'warn', title: 'Global shortcut refused', body: signal.reason });
      }
    });
  }, [store, pushNotice]);

  /* ------------------------------------------------ fullscreen */
  const enterFullscreen = useCallback(
    (next: boolean) => {
      setFullscreen(next);
      if (next) setTab('timer');
      void store.bridge.window.setFullScreen(next);
    },
    [store],
  );

  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') enterFullscreen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fullscreen, enterFullscreen]);

  /* ------------------------------------------------ shortcuts */
  const hotkeys = useMemo<HotkeyMap>(
    () => ({
      'Ctrl+1': (event) => {
        event.preventDefault();
        setTab('home');
      },
      'Ctrl+2': (event) => {
        event.preventDefault();
        setTab('timer');
      },
      'Ctrl+3': (event) => {
        event.preventDefault();
        setTab('activity');
      },
      'Ctrl+4': (event) => {
        event.preventDefault();
        setTab('settings');
      },
      'Ctrl+N': (event) => {
        event.preventDefault();
        setTab('home');
        // The Home column listens for this; routing through an event keeps the
        // shell out of the column's internals.
        window.setTimeout(() => window.dispatchEvent(new Event('daybook:new-task')), 60);
      },
      F11: (event) => {
        event.preventDefault();
        enterFullscreen(!fullscreen);
      },
      Escape: () => {
        if (fullscreen) enterFullscreen(false);
        else if (day) setDay(null);
      },
      ' ': (event) => {
        if (tab !== 'timer') return;
        event.preventDefault();
        void store.bridge.timer.send({ type: 'toggle' });
      },
    }),
    [day, enterFullscreen, fullscreen, store, tab],
  );

  /* ------------------------------------------------ welcome */
  // Shown whenever the document has no name — a fresh install, and once for an
  // owner upgrading from 1.0.0 — or on demand, when DAYBOOK_FORCE_ONBOARDING=1
  // asks for it again.
  //
  // The decision is latched, because the moment the name is saved the document
  // has one: without the latch the shell would seize the window mid-transition
  // and the screen would never get to fade out or say the name back.
  const greet = !profileName || boot?.forceOnboarding === true;
  const welcomeAsked = useRef(false);
  if (ready && greet) welcomeAsked.current = true;
  const welcomeVisible = ready && !bootError && welcomeAsked.current && !welcomeDone;

  useHotkeys(hotkeys, ready && !bootError && !welcomeVisible);

  /* ------------------------------------------------ development layout guard */
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    let frame = 0;
    const check = () => {
      frame = window.setTimeout(() => {
        const root = document.documentElement;
        if (root.scrollHeight > window.innerHeight + 1) {
          console.error(`[layout] the page overflows: ${root.scrollHeight}px of content in ${window.innerHeight}px`);
        }
        document.querySelectorAll<HTMLElement>('[data-guard]').forEach((element) => {
          if (element.scrollHeight > element.clientHeight + 1) {
            console.error(
              `[layout] ${element.dataset.guard} overflows vertically: ${element.scrollHeight}px > ${element.clientHeight}px`,
            );
          }
          if (element.scrollWidth > element.clientWidth + 1) {
            console.error(
              `[layout] ${element.dataset.guard} overflows horizontally: ${element.scrollWidth}px > ${element.clientWidth}px`,
            );
          }
        });
      }, 90);
    };
    check();
    window.addEventListener('resize', check);
    return () => {
      window.clearTimeout(frame);
      window.removeEventListener('resize', check);
    };
  });

  if (bootError) {
    return (
      <div className="relative grid h-full place-items-center bg-paper px-8">
        <WindowControls />
        <div className="w-full max-w-[34rem] rounded-card border border-rule bg-paper-raise p-6 shadow-soft">
          <h1 className="font-display text-head text-ink">Daybook could not open its data file.</h1>
          <p className="mt-2 font-text text-body text-ink-soft">{bootError}</p>
          <p className="mt-3 font-text text-small text-ink-mute">
            The last five saves are kept in %APPDATA%\Daybook\backups. Reload the window, or restore a backup by hand.
          </p>
        </div>
      </div>
    );
  }

  if (!ready) {
    return (
      <div className="relative h-full">
        <BootScreen />
        <WindowControls />
      </div>
    );
  }

  // The Welcome screen owns the whole window until it has a name: no rail, no
  // page bar, and none of the shortcuts above.
  if (welcomeVisible) return <WelcomeScreen onDone={() => setWelcomeDone(true)} />;

  const title =
    tab === 'home' ? `Today${profileName ? `, ${profileName}` : ''}` : tab === 'timer' ? 'Timer' : tab === 'activity' ? 'Activity' : 'Settings';

  const content =
    tab === 'timer' ? (
      <TimerView fullscreen={fullscreen} onToggleFullscreen={() => enterFullscreen(!fullscreen)} />
    ) : tab === 'activity' ? (
      <ActivityView onPick={setDay} />
    ) : tab === 'settings' ? (
      <SettingsView onNotice={pushNotice} />
    ) : (
      <HomeView onNotice={pushNotice} />
    );

  return (
    <div className="relative flex h-full overflow-hidden bg-paper">
      {fullscreen ? null : <WindowControls />}
      {fullscreen ? null : <AppSidebar tab={tab} onTab={setTab} />}

      <div className="flex min-w-0 flex-1 flex-col">
        {fullscreen ? null : <PageBar title={title} />}

        <main className="min-h-0 flex-1 overflow-hidden" data-guard={`tab-${tab}`} id="daybook-content">
          <motion.div
            key={`${tab}-${fullscreen ? 'full' : 'windowed'}`}
            className="h-full"
            initial={false}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.15 }}
          >
            {content}
          </motion.div>
        </main>
      </div>

      <DayDialog date={day} onClose={() => setDay(null)} />
      <NoticeStack notices={notices} onDismiss={(id) => setNotices((list) => list.filter((n) => n.id !== id))} />
    </div>
  );
}

/** A brief, quiet start — the wordmark, a rule, then the day. */
function BootScreen() {
  const reduced = useReducedMotion();
  return (
    <div className="grid h-full place-items-center bg-paper">
      <div className="w-[min(24rem,80vw)] text-center">
        <LogoMark className="mx-auto mb-4 h-10 text-[#001766]" />
        <motion.h1
          className="font-display text-head font-semibold tracking-[-0.03em] text-ink"
          initial={reduced ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: [0.16, 0.84, 0.44, 1] }}
        >
          Daybook<span className="text-accent">.</span>
        </motion.h1>
        <motion.div
          className="mx-auto mt-4 h-[2px] w-16 origin-left bg-accent"
          initial={reduced ? false : { scaleX: 0 }}
          animate={{ scaleX: 1 }}
          transition={{ duration: 0.4, delay: 0.05, ease: [0.16, 0.84, 0.44, 1] }}
        />
      </div>
    </div>
  );
}
