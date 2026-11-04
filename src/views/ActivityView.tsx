import { useData } from '../lib/store';
import { statFigures, totalsFor } from '../lib/stats';
import { formatMinutes, toKey } from '../lib/date';
import { count } from '../lib/format';
import { Heatmap } from '../components/Heatmap';
import { FocusChart } from '../components/FocusChart';

/**
 * Activity, with the controls removed. Three figures, one 30-day chart and the
 * year calendar — all of them measuring the same thing, focus time. There is no
 * filter, no range switch, no tag breakdown and no written insight to decode.
 */
export function ActivityView({ onPick }: { onPick: (date: string) => void }) {
  const data = useData();
  const today = toKey();
  const figures = statFigures(data, 'focus', today);
  const totals = totalsFor(data, today);

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-4">
      <div className="grid shrink-0 grid-cols-3 gap-3">
        <Figure label="Today" value={formatMinutes(totals.focusMin)} />
        <Figure label="This week" value={formatMinutes(figures.weekMin)} />
        <Figure label="Streak" value={count(figures.streak.current, 'day')} />
      </div>

      <section className="card min-h-0 flex-1" aria-labelledby="activity-month">
        <div className="card-head">
          <h2 id="activity-month" className="font-text text-small font-semibold text-ink">
            Last 30 days
          </h2>
        </div>
        <div className="min-h-0 flex-1 px-2 py-2">
          <FocusChart data={data} range="30D" />
        </div>
      </section>

      <section
        className="card h-[14rem] shrink-0"
        aria-labelledby="activity-year"
      >
        <div className="card-head">
          <h2 id="activity-year" className="font-text text-small font-semibold text-ink">
            This year
          </h2>
          <span className="font-text text-micro text-ink-mute">Focus</span>
        </div>
        <div className="flex min-h-0 flex-1 flex-col px-4 pb-2 pt-2">
          <Heatmap data={data} filter="focus" onPick={onPick} />
        </div>
      </section>
    </div>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="card px-4 py-2.5">
      <p className="label">{label}</p>
      <p className="mt-1 font-display text-[1.6rem] font-semibold leading-none tracking-[-0.03em] text-ink tab">{value}</p>
    </div>
  );
}
