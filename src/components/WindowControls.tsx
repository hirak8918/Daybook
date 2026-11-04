import { useEffect, useState } from 'react';
import { useBoot, useStoreApi } from '../lib/store';

/**
 * The three Windows caption buttons, drawn inside the page instead of being
 * overlaid by the operating system. Keeping them here means they share the
 * app's height, colours and hover states at every scale factor.
 */
export function WindowControls() {
  const store = useStoreApi();
  const boot = useBoot();
  const [maximized, setMaximized] = useState(boot?.maximized ?? false);

  useEffect(() => {
    let live = true;
    const sync = () => {
      void store.bridge.window
        .isMaximized()
        .then((value) => {
          if (live) setMaximized(value);
        })
        .catch(() => undefined);
    };
    sync();
    const stop = store.subscribeSignal((signal) => {
      if (signal.kind === 'windowState') sync();
    });
    window.addEventListener('resize', sync);
    return () => {
      live = false;
      stop();
      window.removeEventListener('resize', sync);
    };
  }, [store, boot?.maximized]);

  const toggle = () => {
    void store.bridge.window
      .toggleMaximize()
      .then((value) => setMaximized(Boolean(value)))
      .catch(() => undefined);
  };

  return (
    <div
      className="no-drag fixed right-0 top-0 z-[90] flex h-12 items-stretch bg-paper"
      data-window-controls="true"
    >
      <Control label="Minimize" onClick={() => store.bridge.window.minimize()}>
        <svg width="11" height="11" viewBox="0 0 11 11" aria-hidden="true">
          <path d="M2 5.5h7" stroke="currentColor" strokeWidth="1" />
        </svg>
      </Control>
      <Control label={maximized ? 'Restore' : 'Maximize'} onClick={toggle}>
        {maximized ? (
          <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden="true">
            <path d="M3.5 2.5h5v5" stroke="currentColor" strokeWidth="1" />
            <rect x="1.5" y="3.5" width="5" height="5" stroke="currentColor" strokeWidth="1" />
          </svg>
        ) : (
          <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden="true">
            <rect x="1.5" y="1.5" width="8" height="8" stroke="currentColor" strokeWidth="1" />
          </svg>
        )}
      </Control>
      <Control label="Close" close onClick={() => store.bridge.window.close()}>
        <svg width="11" height="11" viewBox="0 0 11 11" aria-hidden="true">
          <path d="M2 2l7 7M9 2 2 9" stroke="currentColor" strokeWidth="1" />
        </svg>
      </Control>
    </div>
  );
}

function Control({
  label,
  close = false,
  onClick,
  children,
}: {
  label: string;
  close?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={`no-drag flex h-12 w-[46px] items-center justify-center text-ink-soft transition-colors duration-100 hover:text-ink ${
        close ? 'hover:bg-[#c42b1c] hover:text-white' : 'hover:bg-paper-deep'
      }`}
    >
      {children}
    </button>
  );
}