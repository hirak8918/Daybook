import { toKey } from '../lib/date';
import { shortDay } from '../lib/format';
import { IconActivity, IconHome, IconSettings, IconTimer } from './Icons';
import { LogoMark } from './Logo';

export type TabId = 'home' | 'timer' | 'activity' | 'settings';

export const TABS: Array<{ id: TabId; label: string; Icon: typeof IconHome }> = [
  { id: 'home', label: 'Home', Icon: IconHome },
  { id: 'timer', label: 'Timer', Icon: IconTimer },
  { id: 'activity', label: 'Activity', Icon: IconActivity },
  { id: 'settings', label: 'Settings', Icon: IconSettings },
];

/**
 * The left rail. It carries the wordmark, the four sections and nothing else.
 * Its 48px top row is part of the window drag region; the buttons themselves
 * are explicitly no-drag so a click never turns into a window move.
 */
export function AppSidebar({ tab, onTab }: { tab: TabId; onTab: (id: TabId) => void }) {
  return (
    <aside className="flex w-[10.5rem] shrink-0 flex-col border-r border-rule bg-paper-deep">
      <div className="drag flex h-12 shrink-0 items-center gap-2 px-4">
        <LogoMark className="h-5 text-[#001766] dark:text-accent" />
        <span className="font-display text-word font-semibold tracking-[-0.02em] text-ink">
          Daybook<span className="text-accent">.</span>
        </span>
      </div>

      <nav aria-label="Sections" className="no-drag flex flex-col gap-0.5 px-2.5 pt-3">
        {TABS.map(({ id, label, Icon }) => {
          const active = id === tab;
          return (
            <button
              key={id}
              type="button"
              onClick={() => onTab(id)}
              aria-current={active ? 'page' : undefined}
              className={`flex h-10 items-center gap-2.5 rounded-control px-2.5 text-left font-text text-small transition-colors ${
                active
                  ? 'bg-paper-raise text-ink shadow-soft'
                  : 'text-ink-soft hover:bg-paper-raise/70 hover:text-ink'
              }`}
            >
              <Icon size={17} className={active ? 'text-accent' : 'text-ink-mute'} />
              <span className="min-w-0 flex-1 truncate">{label}</span>
              {active ? <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-accent" /> : null}
            </button>
          );
        })}
      </nav>
    </aside>
  );
}

/**
 * The content's 48px title row. It is the rest of the window drag region, and
 * it stops short of the Windows caption buttons on the right.
 */
export function PageBar({ title }: { title: string }) {
  return (
    <header
      className="drag flex h-12 shrink-0 items-center justify-between gap-6 border-b border-rule bg-paper pl-5"
      style={{ paddingRight: '8.75rem' }}
    >
      <h1 className="truncate font-display text-[1.0625rem] font-semibold tracking-[-0.02em] text-ink">{title}</h1>
      <span className="hidden shrink-0 font-text text-micro text-ink-mute sm:block">{shortDay(toKey())}</span>
    </header>
  );
}
