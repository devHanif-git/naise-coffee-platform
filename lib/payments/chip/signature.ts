// Verifies CHIP callback/webhook signatures. CHIP signs the raw request body
// with its private key; we verify with the public key. Algorithm per CHIP docs:
// RSA PKCS#1 v1.5, SHA-256 digest, signature base64-encoded in the X-Signature
// header. MUST verify against the RAW body bytes — parsing JSON first would
// reserialize and break the signature. Server-only (uses node:crypto).

import { createVerify } from "node:crypto";
import { getChipPublicKey } from "@/lib/payments/chip/config";

export function verifyChipSignature(
  rawBody: string,
  xSignatureHeader: string | null,
): boolean {
  if (!xSignatureHeader) return false;

  // Throws if the public key isn't configured — a deploy misconfig, not a
  // per-request failure, so let it surface.
  const publicKey = getChipPublicKey();

  try {
    const verifier = createVerify("RSA-SHA256");
    verifier.update(rawBody, "utf8");
    verifier.end();
    // The header is a base64-encoded signature.
    return verifier.verify(publicKey, xSignatureHeader, "base64");
  } catch {
    // Malformed signature/key material → treat as unverified, never throw.
    return false;
  }
}
