// Calling rules shared by the server and the calling screen. Client-safe.
import type { Outcome, Stage } from "./vocab";

/** Outcomes where someone picked up and talked (used for "reached" / "answered %"). */
export const REACHED_OUTCOMES: Outcome[] = ["answered", "interested", "not_interested", "callback_requested", "will_enroll"];

/** Stages that still need calls. */
export const OPEN_STAGES: Stage[] = ["new", "contacted", "interested", "payment_details_sent"];

const LADDER: Stage[] = ["new", "contacted", "interested", "payment_details_sent", "enrolled"];
const TARGET: Partial<Record<Outcome, Stage>> = {
  answered: "contacted",
  callback_requested: "contacted",
  interested: "interested",
  will_enroll: "interested",
  not_interested: "not_interested",
  wrong_number: "wrong_number",
};

/**
 * The stage after a call. Positive outcomes only move a contact forward (never back from
 * "payment details sent"); "not interested" / "wrong number" set it; nothing overrides
 * "enrolled" or "do not contact"; no answer / busy / switched off change nothing.
 */
export function stageAfter(current: Stage, outcome: Outcome): Stage {
  const target = TARGET[outcome];
  if (!target || current === "enrolled" || current === "do_not_contact") return current;
  if (target === "not_interested" || target === "wrong_number") return target;
  const from = LADDER.indexOf(current); // -1 for not_interested / wrong_number: a new positive outcome reopens it
  return LADDER.indexOf(target) > from ? target : current;
}

// One keyboard shortcut per outcome, 1–9, in this order.
export const OUTCOME_KEYS: Outcome[] = [
  "answered",
  "no_answer",
  "busy",
  "switched_off",
  "interested",
  "callback_requested",
  "will_enroll",
  "not_interested",
  "wrong_number",
];

export const TEMPLATE_PLACEHOLDERS = ["name", "class", "fee", "start_date", "link", "caller"] as const;
export type TemplateVars = Partial<Record<(typeof TEMPLATE_PLACEHOLDERS)[number], string>>;

/** Replaces {name}, {class}, … Unknown or empty placeholders are left visible so the caller notices. */
export function fillTemplate(body: string, vars: TemplateVars) {
  return body.replace(/\{(\w+)\}/g, (m, k: string) => vars[k as keyof TemplateVars] || m);
}
