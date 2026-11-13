/** Escape a spreadsheet cell, including potential CSV formula injection.
 * Reject control characters so an attacker cannot hide a formula after a line break.
 */
export function safeCsvCell(value: unknown): string {
  const raw = String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ")
  const escaped = /^\s*[=+@-]/u.test(raw) ? `\'${raw}` : raw
  return `"${escaped.replace(/"/g, '""')}"`
}
