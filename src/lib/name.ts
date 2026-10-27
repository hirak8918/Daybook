/**
 * The one rule for a person's name — used by the Welcome screen, by Settings
 * and by the reducer that stores it, so the three can never disagree about what
 * is acceptable.
 *
 * A name is 1–24 characters: Unicode letters, spaces, hyphen, apostrophe and
 * full stop. It may contain no digits, no other symbols, and no runs of
 * whitespace (they are collapsed to a single space before anything is checked).
 */

export const NAME_MAX = 24;

/** The first character must be a letter; the rest may be letters, marks or the
 *  four allowed punctuation characters. `\p{L}` covers é, ø, 李, Я and so on. */
const ALLOWED = /^[\p{L}\p{M}][\p{L}\p{M} .,'’-]*$/u;

/** Trim the ends and collapse repeated spaces: "  Ada   Lovelace " → "Ada Lovelace". */
export function cleanName(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw.replace(/\s+/g, ' ').trim();
}

/** Plain-language reason the name cannot be used, or null when it is fine. */
export function nameError(raw: unknown): string | null {
  const name = cleanName(raw);
  if (!name) return 'Enter a name to continue.';
  // Counted in characters, not UTF-16 units, so an emoji or an accented letter
  // is one character — not two.
  if ([...name].length > NAME_MAX) return `A name can be up to ${NAME_MAX} characters.`;
  if (!ALLOWED.test(name)) return 'Letters, spaces, hyphens, apostrophes and full stops only.';
  return null;
}
