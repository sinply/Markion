/** Relative-day helpers for document cards (library home). Pure + testable:
 *  day arithmetic uses LOCAL calendar days, not 24h blocks. */

/** Whole local-calendar days between the given mtime and now
 *  (0 = today, 1 = yesterday, 7 = a week ago, negative = future). */
export function dayDelta(mtimeSecs: number, nowMs: number = Date.now()): number {
  const startOfDay = (ms: number) => {
    const d = new Date(ms);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  };
  if (!mtimeSecs || mtimeSecs <= 0) return 9999;
  const mtimeMs = mtimeSecs * 1000;
  return Math.round((startOfDay(nowMs) - startOfDay(mtimeMs)) / 86_400_000);
}

/** Local YYYY-MM-DD stamp (fallback display for older documents). */
export function fmtDate(mtimeSecs: number): string {
  const d = new Date(mtimeSecs * 1000);
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}
