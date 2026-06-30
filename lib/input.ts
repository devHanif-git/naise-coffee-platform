// Keystroke-level filters for numeric inputs. `inputMode` only hints the mobile
// keyboard — it does NOT stop a physical keyboard from typing letters — so these
// run inside onChange to keep the field's text in a valid shape as the user
// types. They never reject a keystroke outright; they return the new value the
// field should hold (the previous value if the edit isn't allowed), so the input
// stays controlled and the caret behaves.
//
// These are input hygiene, not security. The server actions still validate
// (Number.isInteger, ranges) and the phone normalizer still has the final say.

// Whole, non-negative numbers: drop everything but digits.
// e.g. "12a3" -> "123", "RM5" -> "5". Empty stays empty.
export function filterDigits(value: string): string {
  return value.replace(/\D/g, "");
}

// Signed whole numbers — for fields that accept a delta like Beans adjustments
// ("100" or "-50"). Keeps an optional leading "-" then digits only.
// e.g. "-5a0" -> "-50", "--5" -> "-5", "1-2" -> "12".
export function filterSignedInteger(value: string): string {
  const negative = value.startsWith("-");
  const digits = value.replace(/\D/g, "");
  return negative ? `-${digits}` : digits;
}

// Money/decimal text: digits with at most one decimal point.
// e.g. "5.50" stays, "5.5.0" -> rejected (keeps prior), "ab" -> rejected.
// Returns `prev` when the candidate isn't a valid partial decimal so a stray
// keystroke is ignored rather than clearing the field.
export function filterDecimal(value: string, prev: string): string {
  if (value === "" || /^\d*\.?\d*$/.test(value)) return value;
  return prev;
}

// Phone entry: digits plus the spaces/dashes people use for readability
// (e.g. "11-2561 7058"). The normalizer strips the rest on save; this just keeps
// letters out of the field as it's typed.
export function filterPhone(value: string): string {
  return value.replace(/[^\d\s-]/g, "");
}
