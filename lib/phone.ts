// Sri Lankan phone numbers. Canonical form everywhere: 10 digits starting with 0, e.g. 0712345678.

export type PhoneResult =
  | { ok: true; phone: string; kind: "mobile" | "landline" }
  | { ok: false; reason: "empty" | "invalid" };

const MOBILE = /^07[0-8]\d{7}$/; // 070–078
const LANDLINE = /^0[1-689][1-9]\d{7}$/; // area code (not 07x) + 7 digits

export function normalizePhone(input: unknown): PhoneResult {
  let s = String(input ?? "").trim();
  if (!s) return { ok: false, reason: "empty" };
  s = s.replace(/\.0+$/, ""); // spreadsheet numbers exported as "712345678.0"
  if (/[^\d\s\-+().]/.test(s)) return { ok: false, reason: "invalid" };
  let d = s.replace(/\D/g, "");

  if (d.startsWith("0094")) d = d.slice(4);
  else if (d.length === 11 && d.startsWith("94")) d = d.slice(2);
  if (d.length === 9 && !d.startsWith("0")) d = "0" + d; // Excel dropped the leading 0

  if (MOBILE.test(d)) return { ok: true, phone: d, kind: "mobile" };
  if (LANDLINE.test(d)) return { ok: true, phone: d, kind: "landline" };
  return { ok: false, reason: "invalid" };
}

/** 0712345678 → 94712345678 (wa.me format) */
export const toInternational = (phone: string) => "94" + phone.slice(1);

export const telLink = (phone: string) => `tel:${phone}`;

export const whatsAppLink = (phone: string, text?: string) =>
  `https://wa.me/${toInternational(phone)}` + (text ? `?text=${encodeURIComponent(text)}` : "");
