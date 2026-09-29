// All "today / overdue" logic and display uses Sri Lanka time; storage is UTC.
import { TZDate } from "@date-fns/tz";
import { format } from "date-fns";

export const TZ = "Asia/Colombo";

const inColombo = (d: Date | string) => new TZDate(new Date(d).getTime(), TZ);

export const fmtDateTime = (d: Date | string | null | undefined) => (d ? format(inColombo(d), "d MMM yyyy, h:mm a") : "");
export const fmtDate = (d: Date | string | null | undefined) => (d ? format(inColombo(d), "d MMM yyyy") : "");

/** "2026-09-29" (a calendar date, stored as text) → "29 Sep 2026" */
export const fmtDay = (day: string | null | undefined) => (day ? format(new Date(day + "T00:00:00"), "d MMM yyyy") : "");

export const fmtTime = (d: Date | string | null | undefined) => (d ? format(inColombo(d), "h:mm a") : "");

/** Start (inclusive) and end (exclusive) of the Sri Lankan calendar day containing `now`. */
export function dayBounds(now = new Date()) {
  const c = inColombo(now);
  const start = new TZDate(c.getFullYear(), c.getMonth(), c.getDate(), TZ);
  const end = new TZDate(c.getFullYear(), c.getMonth(), c.getDate() + 1, TZ);
  return { start: new Date(start.getTime()), end: new Date(end.getTime()) };
}

/** Date → "YYYY-MM-DDTHH:mm" in Sri Lanka time, for <input type="datetime-local">. */
export const toLocalInput = (d: Date | string) => format(inColombo(d), "yyyy-MM-dd'T'HH:mm");

/** "YYYY-MM-DDTHH:mm" typed as Sri Lanka time → Date (whatever the device's time zone). */
export function fromLocalInput(s: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(s);
  if (!m) return null;
  const [, y, mo, d, h, mi] = m.map(Number);
  return new Date(new TZDate(y, mo - 1, d, h, mi, TZ).getTime());
}

/** Quick callback times offered in calling mode. */
export function callbackChips(now = new Date()) {
  const c = inColombo(now);
  const tomorrowAt = (h: number) => new Date(new TZDate(c.getFullYear(), c.getMonth(), c.getDate() + 1, h, 0, TZ).getTime());
  return [
    { label: "In 2 hours", at: new Date(now.getTime() + 2 * 3600_000) },
    { label: "Tomorrow morning", at: tomorrowAt(9) },
    { label: "Tomorrow evening", at: tomorrowAt(18) },
  ];
}
