// Framework-free regression check for iOS install-environment detection.
// Run: node components/install-prompt.check.mjs
// Guards the root fix: WhatsApp/Instagram/Chrome-iOS in-app browsers carry
// "Safari"/iOS tokens in their UA but leave navigator.standalone undefined, so
// they MUST map to "recover" (Add to Home Screen impossible there), not "safari".
// Mirror of detectInstallEnv in components/install-prompt.tsx — keep in sync
// (node cannot import the .tsx directly, matching the repo's .check.mjs pattern).
import assert from "node:assert";

function detectInstallEnv(ua, standalone) {
  const isIos = /iphone|ipad|ipod/i.test(ua);
  if (!isIos) return null;
  if (standalone === true) return null;
  return standalone === false ? "safari" : "recover";
}

const IPHONE_SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const WHATSAPP =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148";
const INSTAGRAM =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 300.0.0.0";
const CHROME_IOS =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0 Mobile/15E148 Safari/604.1";
const ANDROID =
  "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36";

// Real Safari, not installed → can Add to Home Screen.
assert.strictEqual(detectInstallEnv(IPHONE_SAFARI, false), "safari", "real Safari → safari");
// In-app WKWebViews leave standalone undefined → must recover, NOT safari.
assert.strictEqual(detectInstallEnv(WHATSAPP, undefined), "recover", "WhatsApp webview → recover");
assert.strictEqual(detectInstallEnv(INSTAGRAM, undefined), "recover", "Instagram webview → recover");
assert.strictEqual(detectInstallEnv(CHROME_IOS, undefined), "recover", "Chrome iOS → recover");
// Already installed (standalone true) → no prompt.
assert.strictEqual(detectInstallEnv(IPHONE_SAFARI, true), null, "installed → null");
// Non-iOS → no iOS path (Android handled by beforeinstallprompt elsewhere).
assert.strictEqual(detectInstallEnv(ANDROID, undefined), null, "android → null");

console.log("ok");
