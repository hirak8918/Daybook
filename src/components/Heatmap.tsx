import { useEffect, useMemo, useRef, useState } from 'react';
import { formatMinutes, fromKey, toKey, type DateKey } from '../lib/date';
import { heatGrid, type HeatCell, type HeatFilter } from '../lib/stats';
import type { DaybookData } from '../lib/schema';

const WEEKDAY_LABELS = ['Mon', 'Wed', 'Fri'];
const WEEKDAY_ROWS = [0, 2, 4];

/**
 * The year at a glance. Fifty-three columns of seven days, square cells sized
 * from the container so the whole year fits without ever scrolling sideways.
 * Five intensity levels measured against the goal for the selected filter;
 * today is simply outlined, never drawn with a special pattern.
 */
export function Heatmap({
  data,
  filter,
  onPick,
}: {
  data: DaybookData;
  filter: HeatFilter;
  onPick: (date: DateKey) => void;
}) {
  const today = toKey();
  const grid = useMemo(() => heatGrid(data, filter, today), [data, filter, today]);
  const wrap = useRef<HTMLDivElement>(null);
  const [cursor, setCursor] = useState<{ col: number; row: number }>(() => {
    const row = (fromKey(today).getDay() + 6) % 7;
    return { col: grid.rows[row].length - 1, row };
  });
  const [hover, setHover] = useState<{ cell: HeatCell; left: number; top: number; above: boolean } | null>(null);
  const wantFocus = useRef(false);

  useEffect(() => {
    if (!wantFocus.current) return;
    wantFocus.current = false;
    const node = wrap.current?.querySelector<HTMLButtonElement>(`[data-cell="${cursor.col}-${cursor.row}"]`);
    node?.focus();
  }, [cursor]);

  const move = (dCol: number, dRow: number) => {
    setCursor((current) => {
      const row = Math.min(6, Math.max(0, current.row + dRow));
      const col = Math.min(grid.rows[row].length - 1, Math.max(0, current.col + dCol));
      const cell = grid.rows[row][col];
      if (cell.future) return { col: Math.min(grid.rows[row].length - 1, col - 1), row };
      wantFocus.current = true;
      return { col, row };
    });
  };

  const showTip = (cell: HeatCell, element: HTMLElement, persist: boolean) => {
    const container = wrap.current;
    if (!container) return;
    const box = container.getBoundingClientRect();
    const rect = element.getBoundingClientRect();
    // Cells are ~17px wide; the tooltip is far wider, so clamp it inside the
    // container and flip it below the cell when there is no room above.
    const width = 260;
    const centre = rect.left - box.left + rect.width / 2;
    const left = Math.max(8, Math.min(box.width - width / 2 - 8, centre));
    const above = rect.top - box.top > 92;
    setHover({
      cell,
      left,
      top: above ? rect.top - box.top - 8 : rect.bottom - box.top + 8,
      above,
    });
    if (persist) setCursor({ col: Number(element.dataset.col), row: Number(element.dataset.row) });
  };

  const cols = grid.rows[0].length;

  return (
    <div className="mx-auto flex min-h-0 w-full max-w-[65rem] flex-col">
      {/* Month axis: one label per month change, aligned to its week column. */}
      <div
        className="mb-1 grid gap-[3px]"
        style={{ gridTemplateColumns: `2.4rem repeat(${cols}, minmax(0, 1rem))` }}
        aria-hidden
      >
        <span />
        {grid.months.map((month) => (
          <span
            key={`${month.label}-${month.column}`}
            className="whitespace-nowrap font-mono text-label normal-case tracking-normal text-ink-mute"
            style={{ gridColumn: `${month.column + 2} / span 4` }}
          >
            {month.label}
          </span>
        ))}
      </div>

      <div
        ref={wrap}
        className="relative grid gap-[3px]"
        style={{
          gridTemplateColumns: `2.4rem repeat(${cols}, minmax(0, 1rem))`,
          gridTemplateRows: 'repeat(7, auto)',
        }}
        onMouseLeave={() => setHover(null)}
        onKeyDown={(event) => {
          const map: Record<string, [number, number]> = {
            ArrowLeft: [-1, 0],
            ArrowRight: [1, 0],
            ArrowUp: [0, -1],
            ArrowDown: [0, 1],
            Home: [-53, 0],
            End: [53, 0],
          };
          const delta = map[event.key];
          if (!delta) return;
          event.preventDefault();
          move(delta[0], delta[1]);
        }}
      >
        {WEEKDAY_ROWS.map((row, index) => (
          <span
            key={row}
            className="self-center font-mono text-label normal-case tracking-normal text-ink-mute"
            style={{ gridColumn: 1, gridRow: row + 1 }}
          >
            {WEEKDAY_LABELS[index]}
          </span>
        ))}

        {grid.rows.map((rowCells, row) =>
          rowCells.map((cell, col) => (
            <button
              key={cell.key}
              type="button"
              data-cell={`${col}-${row}`}
              data-col={col}
              data-row={row}
              tabIndex={cursor.col === col && cursor.row === row ? 0 : -1}
              aria-label={`${cell.key}: ${formatMinutes(cell.totals.focusMin)} focus`}
              disabled={cell.future}
              className={`heat-cell ${cell.future ? 'invisible' : ''}`}
              data-level={cell.level}
              data-today={cell.key === today}
              style={{ gridColumn: col + 2, gridRow: row + 1 }}
              onMouseEnter={(event) => showTip(cell, event.currentTarget, false)}
              onFocus={(event) => showTip(cell, event.currentTarget, false)}
              onClick={() => onPick(cell.key)}
            />
          )),
        )}

        {hover ? (
          <div
            role="presentation"
            data-tip="heatmap"
            className="pointer-events-none absolute z-30 w-[240px] -translate-x-1/2 rounded-control border border-rule bg-paper-raise px-3 py-2 text-left shadow-lift"
            style={{
              left: hover.left,
              top: hover.top,
              transform: hover.above ? 'translate(-50%, -100%)' : 'translate(-50%, 0)',
            }}
          >
            <p className="font-text text-small text-ink">
              {fromKey(hover.cell.key).toLocaleDateString(undefined, {
                weekday: 'short',
                day: 'numeric',
                month: 'long',
                year: 'numeric',
              })}
            </p>
            <p className="mt-0.5 font-text text-micro text-ink-soft tab">
              {formatMinutes(hover.cell.totals.focusMin)} focus
            </p>
          </div>
        ) : null}
      </div>

      <div className="mt-2 flex items-center justify-end gap-1.5">
        <span className="font-text text-micro text-ink-mute">Less</span>
        {[0, 1, 2, 3, 4].map((level) => (
          <span key={level} className="heat-cell h-3 w-3" data-level={level} aria-hidden />
        ))}
        <span className="font-text text-micro text-ink-mute">More</span>
      </div>

      <p className="sr-only" aria-live="polite">
        Use the arrow keys to walk the calendar, and Enter to open a day.
      </p>
    </div>
  );
}
