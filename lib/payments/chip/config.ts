// Server-only CHIP Collect configuration. Never import into a client component —
// it reads the secret key from a server-only env var. CHIP has no CORS, so every
// CHIP call happens on the server anyway.

// Test mode and live mode issue DIFFERENT secret/public keys. During development
// these hold the Test Mode credentials; going live swaps the env values.
const CHIP_BASE_URL = "https://gate.chip-in.asia/api/v1";

export type ChipConfig = {
  baseUrl: string;
  brandId: string;
  secretKey: string;
};

// Secret key + brand id are needed to create/retrieve purchases. Throws loudly
// if unset so a misconfigured deploy fails fast instead of calling CHIP anon.
export function getChipConfig(): ChipConfig {
  const secretKey = process.env.CHIP_SECRET_KEY;
  const brandId = process.env.CHIP_BRAND_ID;
  if (!secretKey) throw new Error("CHIP_SECRET_KEY is not set.");
  if (!brandId) throw new Error("CHIP_BRAND_ID is not set.");
  return { baseUrl: CHIP_BASE_URL, brandId, secretKey };
}

// The public key verifies webhook / success_callback signatures. Separate getter
// because most code paths (create purchase) don't need it.
export function getChipPublicKey(): string {
  const publicKey = process.env.CHIP_PUBLIC_KEY;
  if (!publicKey) throw new Error("CHIP_PUBLIC_KEY is not set.");
  return publicKey;
}
