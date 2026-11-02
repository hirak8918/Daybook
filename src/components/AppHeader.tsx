import { toKey } from '../lib/date';
import { shortDay } from '../lib/format';

export type TabId = 'home' | 'timer' | 'activity' | 'settings';

export const TABS: Array<{ id: TabId; label: string }> = [
  { id: 'home', label: 'Home' },
  { id: 'timer', label: 'Timer' },
  { id: 'activity', label: 'Activity' },
  { id: 'settings', label: 'Settings' },
];

/**
 * The whole chrome: one 48px row that doubles as the window drag region, the
 * tab strip and the date line. Windows keeps drawing its own minimise /
 * maximise / close buttons in the title-bar overlay, so the right-hand end of
 * this row is left clear for them.
 */
export function AppHeader({ tab, onTab }: { tab: TabId; onTab: (id: TabId) => void }) {
  return (
    <header
      className="drag flex h-bar shrink-0 items-stretch border-b border-rule bg-paper"
      style={{ paddingRight: '8.75rem' }}
    >
      <div className="flex items-center pl-4 pr-5">
        <span className="font-display text-word font-semibold tracking-tight text-ink">Daybook</span>
      </div>

      <nav aria-label="Sections" className="no-drag flex items-stretch">
        {TABS.map((entry) => {
          const active = entry.id === tab;
          return (
            <button
              key={entry.id}
              type="button"
              onClick={() => onTab(entry.id)}
              aria-current={active ? 'page' : undefined}
              className={`relative flex items-center px-3 font-text text-small transition-colors ${
                active ? 'text-ink' : 'text-ink-mute hover:text-ink'
              }`}
            >
              {entry.label}
              <span
                aria-hidden
                className={`absolute inset-x-2 bottom-0 h-[2px] origin-left bg-accent transition-transform duration-150 ${
                  active ? 'scale-x-100' : 'scale-x-0'
                }`}
              />
            </button>
          );
        })}
      </nav>

      <div className="no-drag ml-auto flex items-center pr-2">
        <span className="meta">{shortDay(toKey())}</span>
      </div>
    </header>
  );
}
