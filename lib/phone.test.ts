import { describe, expect, it } from "vitest";
import { normalizePhone, telLink, whatsAppLink } from "./phone";

describe("normalizePhone", () => {
  it.each([
    ["0712345678", "0712345678", "mobile"],
    ["071 234 5678", "0712345678", "mobile"],
    ["071-234-5678", "0712345678", "mobile"],
    ["(071) 234-5678", "0712345678", "mobile"],
    ["712345678", "0712345678", "mobile"], // Excel dropped the 0
    ["712345678.0", "0712345678", "mobile"],
    ["94712345678", "0712345678", "mobile"],
    ["+94712345678", "0712345678", "mobile"],
    ["+94 71 234 5678", "0712345678", "mobile"],
    ["0094712345678", "0712345678", "mobile"],
    ["0771234567", "0771234567", "mobile"],
    ["0701234567", "0701234567", "mobile"],
    ["0112345678", "0112345678", "landline"], // Colombo
    ["812345678", "0812345678", "landline"], // Kandy, dropped 0
    ["+94 91 223 4567", "0912234567", "landline"], // Galle
    [7.12345678e8, "0712345678", "mobile"], // numeric cell
  ])("%s → %s", (input, phone, kind) => {
    expect(normalizePhone(input)).toEqual({ ok: true, phone, kind });
  });

  it.each([
    ["", "empty"],
    ["   ", "empty"],
    [null, "empty"],
    [undefined, "empty"],
    ["071234567", "invalid"], // 9 digits starting with 0
    ["07123456789", "invalid"], // too long
    ["0791234567", "invalid"], // 079 not a mobile prefix
    ["0012345678", "invalid"],
    ["1234", "invalid"],
    ["0712345678 / 0771234567", "invalid"], // two numbers in one cell
    ["071234567a", "invalid"],
    ["+1 202 555 0100", "invalid"],
    ["95712345678", "invalid"],
  ])("%s is %s", (input, reason) => {
    expect(normalizePhone(input)).toEqual({ ok: false, reason });
  });
});

describe("links", () => {
  it("builds tel: and wa.me links", () => {
    expect(telLink("0712345678")).toBe("tel:0712345678");
    expect(whatsAppLink("0712345678")).toBe("https://wa.me/94712345678");
    expect(whatsAppLink("0712345678", "ආයුබෝවන් Kamal & co?")).toBe(
      "https://wa.me/94712345678?text=" + encodeURIComponent("ආයුබෝවන් Kamal & co?"),
    );
  });
});
