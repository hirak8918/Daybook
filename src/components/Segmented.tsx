/**
 * Segmented control — one component for every either/or in the app
 * (Pomodoro|Custom, the heatmap filters, the chart range, the theme). A real
 * radio group would be heavier to read; this keeps the choice visible.
 */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  disabled,
  disabledReason,
}: {
  value: T;
  options: Array<{ id: T; label: string }>;
  onChange: (next: T) => void;
  label: string;
  disabled?: boolean;
  /** Shown as a native tooltip when the control is locked (e.g. mid-session). */
  disabledReason?: string;
}) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          aria-pressed={option.id === value}
          onClick={() => onChange(option.id)}
          disabled={disabled}
          title={disabled ? disabledReason : undefined}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
