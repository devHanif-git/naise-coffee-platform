// Malaysian (MY) mobile phone helpers — the single source of truth for turning
// user-typed numbers into a stored E.164 value (+60…) and back. No verification:
// we only collect and format. Nationally a mobile is 01X-XXXXXXX; in E.164 the
// leading 0 is dropped, e.g. 011-2561 7058 -> +601125617058.

// Accepts "+60…", "60…", "0…", or a bare national number, with spaces or dashes.
// Returns the E.164 string when it looks like a valid MY mobile, else null so the
// caller can show an error. Empty/whitespace returns null too — callers treat an
// empty field as "no number" and skip calling this.
export function normalizeMyPhone(input: string): string | null {
  const digits = input.replace(/\D/g, "");
  if (!digits) return null;

  // Reduce to the subscriber part (no country code, no leading 0).
  let national: string;
  if (digits.startsWith("60")) {
    national = digits.slice(2);
  } else if (digits.startsWith("0")) {
    national = digits.slice(1);
  } else {
    national = digits;
  }

  // MY mobile subscriber part: starts with 1, total 9–10 digits
  // (e.g. 12 345 6789 = 9, 11 2561 7058 = 10).
  if (!/^1\d{8,9}$/.test(national)) return null;

  return `+60${national}`;
}

// Renders a stored +60… value as "+60 11-2561 7058" for read-back in the UI.
// Best-effort: returns the input unchanged if it doesn't match the expected shape.
export function formatMyPhoneForDisplay(e164: string): string {
  const m = /^\+60(1\d)(\d{3,4})(\d{4})$/.exec(e164);
  if (!m) return e164;
  return `+60 ${m[1]}-${m[2]} ${m[3]}`;
}

// Renders a stored +60… value as the NATIONAL part only ("11-2561 7058") — for
// inputs that already show a "+60" prefix affordance. Best-effort: strips a
// leading +60 if the shape doesn't match.
export function formatMyPhoneNational(e164: string): string {
  const m = /^\+60(1\d)(\d{3,4})(\d{4})$/.exec(e164);
  if (!m) return e164.replace(/^\+?60/, "");
  return `${m[1]}-${m[2]} ${m[3]}`;
}

// Strips to bare international digits for a wa.me/<digits> link (no +, no
// spaces): "+601125617058" -> "601125617058".
export function toWaMeDigits(e164: string): string {
  return e164.replace(/\D/g, "");
}
