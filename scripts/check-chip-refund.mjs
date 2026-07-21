// Smoke check for lib/payments/chip/refund pure helpers. No test runner in this
// repo, so this is a plain Node script: run with `npx tsx scripts/check-chip-refund.mjs`.
// Exits non-zero on the first failed assertion.
import assert from "node:assert/strict";
import { isRefundAccepted, deriveRefundState } from "../lib/payments/chip/refund.ts";

// isRefundAccepted: an immediate "refunded" and the async "pending_refund" both
// count as accepted; every other CHIP status does not.
assert.equal(isRefundAccepted("refunded"), true);
assert.equal(isRefundAccepted("pending_refund"), true);
assert.equal(isRefundAccepted("paid"), false);
assert.equal(isRefundAccepted("created"), false);
assert.equal(isRefundAccepted(""), false);

// deriveRefundState: the three states from (refundedAt, refundError).
assert.equal(deriveRefundState({ refundedAt: null, refundError: null }), "none");
assert.equal(
  deriveRefundState({ refundedAt: "2026-07-21T00:00:00Z", refundError: null }),
  "refunded",
);
assert.equal(
  deriveRefundState({ refundedAt: null, refundError: "CHIP refund failed (400)" }),
  "failed",
);
// A recorded refund wins even if a stale error lingers from an earlier attempt.
assert.equal(
  deriveRefundState({ refundedAt: "2026-07-21T00:00:00Z", refundError: "stale" }),
  "refunded",
);

console.log("chip-refund checks passed");
