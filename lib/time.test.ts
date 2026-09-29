import { describe, expect, it } from "vitest";
import { callbackChips, dayBounds, fromLocalInput, toLocalInput } from "./time";

describe("Sri Lanka day boundaries (UTC+5:30)", () => {
  it.each([
    ["2026-10-01T18:29:59Z", "2026-09-30T18:30:00.000Z"], // 23:59:59 on 1 Oct in Colombo
    ["2026-10-01T18:30:00Z", "2026-10-01T18:30:00.000Z"], // 00:00 on 2 Oct in Colombo
    ["2026-10-01T00:00:00Z", "2026-09-30T18:30:00.000Z"], // 05:30 on 1 Oct
  ])("%s falls in the day starting %s", (now, start) => {
    const b = dayBounds(new Date(now));
    expect(b.start.toISOString()).toBe(start);
    expect(b.end.getTime() - b.start.getTime()).toBe(24 * 3600_000);
  });
});

it("converts datetime-local values as Sri Lanka time", () => {
  expect(fromLocalInput("2026-10-02T09:00")?.toISOString()).toBe("2026-10-02T03:30:00.000Z");
  expect(toLocalInput(new Date("2026-10-02T03:30:00Z"))).toBe("2026-10-02T09:00");
  expect(fromLocalInput("tomorrow")).toBeNull();
});

it("offers callback chips in Sri Lanka time", () => {
  const [in2h, morning, evening] = callbackChips(new Date("2026-10-01T18:00:00Z")); // 23:30 on 1 Oct
  expect(in2h.at.toISOString()).toBe("2026-10-01T20:00:00.000Z");
  expect(morning.at.toISOString()).toBe("2026-10-02T03:30:00.000Z"); // 2 Oct 09:00
  expect(evening.at.toISOString()).toBe("2026-10-02T12:30:00.000Z"); // 2 Oct 18:00
});
