import { describe, it, expect } from "vitest";
import { dayDelta, fmtDate } from "../relativeTime";

// 2026-08-18 12:00 local
const NOW = new Date(2026, 7, 18, 12, 0, 0).getTime();
const secs = (y: number, m: number, d: number, h = 12) =>
  Math.floor(new Date(y, m - 1, d, h, 0, 0).getTime() / 1000);

describe("dayDelta", () => {
  it("returns 0 only for today", () => {
    expect(dayDelta(secs(2026, 8, 18, 0), NOW)).toBe(0);
    expect(dayDelta(secs(2026, 8, 18, 23), NOW)).toBe(0);
  });

  it("counts calendar days, not 24-hour blocks", () => {
    // Yesterday 23:00 is under 24h ago but still a different calendar day.
    expect(dayDelta(secs(2026, 8, 17, 23), NOW)).toBe(1);
    expect(dayDelta(secs(2026, 8, 17, 10), NOW)).toBe(1);
    expect(dayDelta(secs(2026, 8, 16), NOW)).toBe(2);
    expect(dayDelta(secs(2026, 8, 11), NOW)).toBe(7);
  });

  it("handles month boundaries", () => {
    expect(dayDelta(secs(2026, 7, 31), NOW)).toBe(18);
  });

  it("returns a huge delta for missing timestamps", () => {
    expect(dayDelta(0, NOW)).toBeGreaterThan(100);
  });
});

describe("fmtDate", () => {
  it("formats as local YYYY-MM-DD with zero padding", () => {
    expect(fmtDate(secs(2026, 8, 5))).toBe("2026-08-05");
  });
});
