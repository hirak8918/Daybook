/**
 * A switch, not a checkbox in disguise: 40px hit target, ink track, accent
 * knob position. Label sits to the left in the Settings cards.
 */
export function Toggle({
  checked,
  onChange,
  label,
  id,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  id?: string;
}) {
  return (
    <button
      type="button"
      id={id}
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-[22px] w-[42px] shrink-0 items-center border transition-colors ${
        checked ? 'border-accent bg-accent' : 'border-rule-strong bg-paper-deep'
      }`}
      style={{ minHeight: 22 }}
    >
      <span
        aria-hidden
        className={`absolute top-[2px] h-[16px] w-[16px] transition-all duration-150 ${
          checked ? 'left-[22px] bg-accent-ink' : 'left-[2px] bg-ink-mute'
        }`}
      />
      <span className="sr-only">{checked ? 'On' : 'Off'}</span>
    </button>
  );
}
