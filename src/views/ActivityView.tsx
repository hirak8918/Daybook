import { useState, type ReactNode } from 'react';
import { useData } from '../lib/store';
import { HEAT_FILTERS, RANGES, bestWeekdayLine, statFigures, streakRule, type HeatFilter, type RangeId } from '../lib/stats';
import { formatMinutes, toKey } from '../lib/date';
import { count, dayMonth } from '../lib/format';
import { Heatmap } from '../components/Heatmap';
import { FocusChart } from '../components/FocusChart';
import { TagChart } from '../components/TagChart';
import { Segmented } from '../components/Segmented';
import { InfoTip } from '../components/Tooltip';

/**
 * Activity — the year at a glance and a few honest graphs. Four figures at the
 * top, one heatmap, two charts, nothing else. The filter above the heatmap also
 * drives the streak figure; the range toggle drives both charts.
 */
export function ActivityView({ onPick }: { onPick: (date: string) => void }) {
  const data = useData();
  const [filter, setFilter] = useState<HeatFilter>('combined');
  const [range, setRange] = useState<RangeId>('30D');

  const today = toKey();
  const figures = statFigures(data, filter, today);
  const insight = bestWeekdayLine(data, today);

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 px-8 py-4">
      <div className="grid shrink-0 grid-cols-4 border border-rule">
        <Figure label="This week" value={formatMinutes(figures.weekMin)} />
        <Figure label="30-day average" value={`${formatMinutes(figures.averagePerDay)}/day`} divided />
        <Figure
          label="Best day"
          value={figures.best ? `${formatMinutes(figures.best.focusMin)} · ${dayMonth(figures.best.key)}` : '—'}
          divided
        />
        <Figure
          label={`Streak · ${HEAT_FILTERS.find((f) => f.id === filter)?.label}`}
          value={`${count(figures.streak.current, 'day')} · best ${count(figures.streak.longest, 'day')}`}
          divided
          tip={<InfoTip label="How the runs are counted" text={streakRule(filter)} />}
        />
      </div>

      {insight ? <p className="shrink-0 font-display text-lg italic text-ink-soft">{insight}</p> : null}

      <section className="flex min-h-0 flex-col" aria-labelledby="activity-heatmap">
        <div className="flex shrink-0 items-center justify-between gap-3">
          <h2 id="activity-heatmap" className="font-text text-small font-medium text-ink">
            Last 12 months
          </h2>
          <Segmented label="What the heatmap measures" value={filter} onChange={setFilter} options={HEAT_FILTERS} />
        </div>
        <div className="mt-2">
          <Heatmap data={data} filter={filter} onPick={onPick} />
        </div>
      </section>

      <section className="flex min-h-0 flex-1 flex-col" aria-labelledby="activity-charts">
        <div className="flex shrink-0 items-center justify-between gap-3 border-t border-rule pt-2">
          <h2 id="activity-charts" className="font-text text-small font-medium text-ink">
            Focus time
          </h2>
          <Segmented label="Chart range" value={range} onChange={setRange} options={RANGES} />
        </div>

        <div className="mt-2 grid min-h-0 flex-1 grid-cols-[minmax(0,3fr)_minmax(0,2fr)] gap-6">
          <div className="min-h-0">
            <FocusChart data={data} range={range} />
          </div>
          <div className="flex min-h-0 flex-col border-l border-rule pl-4">
            <p className="label normal-case tracking-normal">By tag</p>
            <div className="mt-2 min-h-0 flex-1">
              <TagChart data={data} range={range} />
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

function Figure({
  label,
  value,
  divided,
  tip,
}: {
  label: string;
  value: string;
  divided?: boolean;
  tip?: ReactNode;
}) {
  return (
    <div className={`px-4 py-2 ${divided ? 'border-l border-rule' : ''}`}>
      <p className="label flex items-center gap-1.5 normal-case tracking-normal">
        {label}
        {tip}
      </p>
      <p className="mt-0.5 font-display text-2xl leading-tight text-ink tab">{value}</p>
    </div>
  );
}
