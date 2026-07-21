// Pure refund-state helpers for the CHIP gateway. No I/O — kept separate from the
// API client so they are unit-testable and shareable with the UI.

// CHIP purchase statuses that count as a refund we can record as done. A DuitNow
// QR refund often settles asynchronously and returns "pending_refund" rather than
// an immediate "refunded"; both mean CHIP accepted the refund.
export function isRefundAccepted(status: string): boolean {
  return status === "refunded" || status === "pending_refund";
}

// The refund state of a chip_purchases row, derived from its two nullable stamps.
// A set refunded_at wins (a recorded refund); otherwise a set refund_error marks a
// failed, retryable attempt; otherwise nothing has been tried.
export type RefundState = "none" | "refunded" | "failed";

export function deriveRefundState(input: {
  refundedAt: string | null;
  refundError: string | null;
}): RefundState {
  if (input.refundedAt) return "refunded";
  if (input.refundError) return "failed";
  return "none";
}
