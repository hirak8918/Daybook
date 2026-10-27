import { useEffect } from 'react';

/**
 * In-app shortcuts, Windows-first: every binding uses Ctrl (never Cmd).
 *
 *   Ctrl+1 / 2 / 3 / 4   Home, Timer, Activity, Settings
 *   Ctrl+N               add a task (Home)
 *   Space                start / pause (Timer)
 *   F11                  fullscreen (Timer)
 *   Esc                  dismiss the topmost overlay
 *
 * A plain key (Space, Esc) never fires while the user is typing into a field or
 * contenteditable element; anything with a modifier still does.
 */
export interface HotkeyMap {
  [combo: string]: (event: KeyboardEvent) => void;
}

function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

function comboFor(event: KeyboardEvent): string {
  const parts: string[] = [];
  if (event.ctrlKey) parts.push('Ctrl');
  if (event.altKey) parts.push('Alt');
  if (event.shiftKey) parts.push('Shift');
  const key = event.key.length === 1 ? event.key.toUpperCase() : event.key;
  parts.push(key === 'ESC' ? 'Escape' : key);
  return parts.join('+');
}

export function useHotkeys(map: HotkeyMap, enabled = true): void {
  useEffect(() => {
    if (!enabled) return;
    const handler = (event: KeyboardEvent) => {
      const combo = comboFor(event);
      const fn = map[combo];
      if (!fn) return;
      const typing = isTypingTarget(event.target);
      const hasModifier = event.ctrlKey || event.altKey || event.metaKey;
      if (typing && combo !== 'Escape' && !hasModifier) return;
      fn(event);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [map, enabled]);
}
