import { expect, it } from "vitest";
import "@/test/db";
import { clear, hit } from "./rate-limit";

it("allows `limit` hits per window, then blocks until cleared", async () => {
  const results = [];
  for (let i = 0; i < 6; i++) results.push(await hit("email:a", 5, 60_000));
  expect(results).toEqual([true, true, true, true, true, false]);
  expect(await hit("email:b", 5, 60_000)).toBe(true); // keys are independent

  await clear("email:a");
  expect(await hit("email:a", 5, 60_000)).toBe(true);
});

it("starts a new window once the old one has expired", async () => {
  expect(await hit("ip:1", 1, 1)).toBe(true); // 1 ms window
  await new Promise((r) => setTimeout(r, 5));
  expect(await hit("ip:1", 1, 60_000)).toBe(true);
  expect(await hit("ip:1", 1, 60_000)).toBe(false);
});
