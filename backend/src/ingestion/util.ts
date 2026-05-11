/** Lowercase, non-alphanumeric runs → single hyphen, trimmed. Used to build `cpz.id`. */
export function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
