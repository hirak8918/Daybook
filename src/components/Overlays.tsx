import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { IconClose, IconWarn } from './Icons';

/* ------------------------------------------------------------------ *
 * Sheet — the one modal shell: sharp corners, hard offset, no glass.
 * ------------------------------------------------------------------ */

export function Sheet({
  open,
  onClose,
  title,
  children,
  width = '34rem',
  scroll = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  width?: string;
  /** The Day dialog is the one panel allowed to scroll internally. */
  scroll?: boolean;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    return () => {
      window.removeEventListener('keydown', onKey);
      previous?.focus?.();
    };
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="fixed inset-0 z-40 flex"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
        >
          <button
            type="button"
            aria-label="Close"
            className="absolute inset-0 cursor-default bg-ink/30"
            onClick={onClose}
            tabIndex={-1}
          />
          <motion.div
            ref={panel}
            role="dialog"
            aria-modal="true"
            aria-label={title}
            tabIndex={-1}
            className="relative z-10 m-auto flex max-h-[calc(100vh-3rem)] flex-col rounded-card border border-rule bg-paper-raise shadow-lift"
            style={{ width, maxWidth: 'calc(100% - 3rem)' }}
            initial={reduced ? false : { y: 10, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={reduced ? { opacity: 0 } : { y: 10, opacity: 0 }}
            transition={{ duration: 0.18, ease: [0.16, 0.84, 0.44, 1] }}
          >
            <header className="flex items-center justify-between gap-4 border-b border-rule px-5 py-3">
              <h2 className="font-text text-body font-semibold leading-tight text-ink">{title}</h2>
              <button className="btn-text no-rule -mr-1" onClick={onClose} aria-label="Close dialog">
                <IconClose size={16} />
              </button>
            </header>
            <div className={scroll ? 'min-h-0 flex-1 overflow-y-auto px-5 py-4' : 'px-5 py-4'}>{children}</div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

/* ------------------------------------------------------------------ *
 * Confirm dialog — optionally gated behind a typed word.
 * ------------------------------------------------------------------ */

export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger = true,
  /** When set, the user must type this word exactly (used for erasing data). */
  requireTyped,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  body: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  requireTyped?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const [typed, setTyped] = useState('');
  useEffect(() => {
    if (open) setTyped('');
  }, [open]);
  const ready = !requireTyped || typed.trim().toUpperCase() === requireTyped.toUpperCase();

  return (
    <Sheet open={open} onClose={onCancel} title={title} width="30rem">
      <div className="flex gap-3">
        {danger ? <IconWarn size={24} className="mt-0.5 shrink-0 text-accent" /> : null}
        <div className="space-y-2 font-text text-small text-ink-soft">{body}</div>
      </div>

      {requireTyped ? (
        <label className="mt-4 block">
          <span className="label">Type {requireTyped} to confirm</span>
          <input
            className="field mt-1"
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            autoFocus
            aria-label={`Type ${requireTyped} to confirm`}
            spellCheck={false}
          />
        </label>
      ) : null}

      <div className="mt-5 flex items-center justify-end gap-2">
        <button className="btn" onClick={onCancel}>
          {cancelLabel}
        </button>
        <button className={danger ? 'btn btn-primary' : 'btn'} onClick={onConfirm} disabled={!ready}>
          {confirmLabel}
        </button>
      </div>
    </Sheet>
  );
}

/* ------------------------------------------------------------------ *
 * Notices — small stack, bottom-left, with at most one action each.
 * ------------------------------------------------------------------ */

export interface Notice {
  id: string;
  tone: 'info' | 'warn' | 'good';
  title: string;
  body?: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function NoticeStack({ notices, onDismiss }: { notices: Notice[]; onDismiss: (id: string) => void }) {
  return (
    <div className="pointer-events-none fixed bottom-4 left-4 z-50 flex w-[24rem] max-w-[calc(100vw-2rem)] flex-col gap-2">
      <AnimatePresence initial={false}>
        {notices.map((notice) => (
          <motion.div
            key={notice.id}
            layout
            initial={{ opacity: 0, x: -12 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -12 }}
            transition={{ duration: 0.18, ease: [0.16, 0.84, 0.44, 1] }}
            className={`pointer-events-auto rounded-control border bg-paper-raise px-3 py-2 shadow-lift ${
              notice.tone === 'warn' ? 'border-accent' : 'border-rule'
            }`}
            role="status"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-text text-small text-ink">{notice.title}</p>
                {notice.body ? <p className="mt-0.5 font-text text-micro text-ink-soft">{notice.body}</p> : null}
                {notice.actionLabel && notice.onAction ? (
                  <button
                    className="btn-text mt-1"
                    onClick={() => {
                      notice.onAction?.();
                      onDismiss(notice.id);
                    }}
                  >
                    {notice.actionLabel}
                  </button>
                ) : null}
              </div>
              <button className="btn-text no-rule -mr-1" onClick={() => onDismiss(notice.id)} aria-label="Dismiss notice">
                <IconClose size={14} />
              </button>
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
