import { describe, expect, it } from "vitest";
import { fillTemplate, OUTCOME_KEYS, stageAfter } from "./calling";
import { OUTCOMES } from "./vocab";

describe("stageAfter", () => {
  it.each([
    ["new", "answered", "contacted"],
    ["new", "no_answer", "new"],
    ["new", "busy", "new"],
    ["new", "switched_off", "new"],
    ["new", "callback_requested", "contacted"],
    ["new", "interested", "interested"],
    ["new", "will_enroll", "interested"],
    ["contacted", "not_interested", "not_interested"],
    ["new", "wrong_number", "wrong_number"],
    ["interested", "answered", "interested"], // never moves back
    ["payment_details_sent", "interested", "payment_details_sent"],
    ["enrolled", "not_interested", "enrolled"],
    ["do_not_contact", "interested", "do_not_contact"],
    ["not_interested", "interested", "interested"], // changed their mind
    ["wrong_number", "no_answer", "wrong_number"],
  ] as const)("%s + %s → %s", (from, outcome, to) => {
    expect(stageAfter(from, outcome)).toBe(to);
  });
});

it("maps every outcome to exactly one key 1–9", () => {
  expect([...OUTCOME_KEYS].sort()).toEqual([...OUTCOMES].sort());
});

it("fills template placeholders, including Sinhala text", () => {
  expect(
    fillTemplate("ආයුබෝවන් {name}! {class} පන්තිය {start_date} ආරම්භ වේ. ගාස්තුව {fee}. {link} — {caller} {unknown} {fee}", {
      name: "Kamal",
      class: "2027 A/L Theory",
      start_date: "1 Oct 2026",
      fee: "Rs. 2,500",
      link: "",
      caller: "Nimali",
    }),
  ).toBe("ආයුබෝවන් Kamal! 2027 A/L Theory පන්තිය 1 Oct 2026 ආරම්භ වේ. ගාස්තුව Rs. 2,500. {link} — Nimali {unknown} Rs. 2,500");
});
