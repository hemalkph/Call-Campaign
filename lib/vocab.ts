// One status vocabulary for the whole app: value → label + badge colour. Client-safe.

export const STAGES = [
  "new",
  "contacted",
  "interested",
  "payment_details_sent",
  "enrolled",
  "not_interested",
  "wrong_number",
  "do_not_contact",
] as const;
export type Stage = (typeof STAGES)[number];

export const STAGE_META: Record<Stage, { label: string; className: string }> = {
  new: { label: "New", className: "bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-100" },
  contacted: { label: "Contacted", className: "bg-sky-100 text-sky-900 dark:bg-sky-900 dark:text-sky-100" },
  interested: { label: "Interested", className: "bg-amber-100 text-amber-900 dark:bg-amber-900 dark:text-amber-100" },
  payment_details_sent: {
    label: "Payment details sent",
    className: "bg-violet-100 text-violet-900 dark:bg-violet-900 dark:text-violet-100",
  },
  enrolled: { label: "Enrolled", className: "bg-emerald-100 text-emerald-900 dark:bg-emerald-900 dark:text-emerald-100" },
  not_interested: { label: "Not interested", className: "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300" },
  wrong_number: { label: "Wrong number", className: "bg-rose-100 text-rose-900 dark:bg-rose-900 dark:text-rose-100" },
  do_not_contact: { label: "Do not contact", className: "bg-red-200 text-red-950 dark:bg-red-950 dark:text-red-100" },
};

export const OUTCOMES = [
  "answered",
  "no_answer",
  "busy",
  "switched_off",
  "wrong_number",
  "interested",
  "not_interested",
  "callback_requested",
  "will_enroll",
] as const;
export type Outcome = (typeof OUTCOMES)[number];

export const OUTCOME_LABEL: Record<Outcome, string> = {
  answered: "Answered",
  no_answer: "No answer",
  busy: "Busy",
  switched_off: "Switched off",
  wrong_number: "Wrong number",
  interested: "Interested",
  not_interested: "Not interested",
  callback_requested: "Callback requested",
  will_enroll: "Will enroll",
};

export const CAMPAIGN_STATUSES = ["draft", "active", "ended"] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

export const CAMPAIGN_STATUS_META: Record<CampaignStatus, { label: string; className: string }> = {
  draft: { label: "Draft", className: "bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-100" },
  active: { label: "Active", className: "bg-emerald-100 text-emerald-900 dark:bg-emerald-900 dark:text-emerald-100" },
  ended: { label: "Ended", className: "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300" },
};

export const DISTRICTS = [
  "Ampara", "Anuradhapura", "Badulla", "Batticaloa", "Colombo", "Galle", "Gampaha", "Hambantota", "Jaffna",
  "Kalutara", "Kandy", "Kegalle", "Kilinochchi", "Kurunegala", "Mannar", "Matale", "Matara", "Monaragala",
  "Mullaitivu", "Nuwara Eliya", "Polonnaruwa", "Puttalam", "Ratnapura", "Trincomalee", "Vavuniya",
];

export const EXPORT_TYPES = ["contacts", "calls", "whatsapp", "callbacks", "performance"] as const;
export type ExportType = (typeof EXPORT_TYPES)[number];
export type ExportRow = Record<string, string | number | null>;
