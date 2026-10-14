// ── Tool-wide year-axis convention ──────────────────────────────────────────────────────────────
// An analysis runs 15–25 years, and a label under every column is an unreadable smear. Every chart
// with a year x-axis therefore labels every FIFTH year, counting from the first one plotted.
//
// The same rule is applied to the exported charts server-side (export_data.year_label_step, used by
// the xlsx chart export and the PowerPoint deck), so screen, Excel and slides all agree.
export const YEAR_LABEL_EVERY = 5;
const YEAR_LABEL_MIN = 10;          // below this many years they all fit; leave them alone

/** How many years apart the labels should sit: 5 for a long run of CONSECUTIVE years, else 1.
 *  The consecutive test protects axes whose categories are chosen reference years (2025/2030/2040),
 *  where every label already carries weight. */
export function yearLabelStep(years: (number | string)[]): number {
  const ys = years.map(y => Number(y));
  if (ys.length < YEAR_LABEL_MIN || ys.some(y => !Number.isFinite(y))) return 1;
  for (let i = 1; i < ys.length; i++) if (ys[i] - ys[i - 1] !== 1) return 1;
  return YEAR_LABEL_EVERY;
}

/** recharts `XAxis interval` — the count of ticks SKIPPED between two labels, so one less than the
 *  step. Pass the chart's row data; the year is read from `key` (default 'year'). */
export function yearAxisInterval(rows: any[], key = 'year'): number {
  return yearLabelStep((rows || []).map(r => r?.[key])) - 1;
}
