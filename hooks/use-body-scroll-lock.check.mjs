// Framework-free regression check for the refcounted scroll lock.
// Run: node hooks/use-body-scroll-lock.check.mjs
// Mirrors the hook's algorithm (module state + mount/unmount lifecycle) and
// asserts the post-login stacking case that caused the iOS "can't scroll after
// dismissing Install with Later" bug.
import assert from "node:assert";

let locks = 0;
let restore = "";
const body = { overflow: "" };

// Simulates one useEffect(active) mount; returns its cleanup (unmount) fn.
function lock() {
  if (locks === 0) {
    restore = body.overflow;
    body.overflow = "hidden";
  }
  locks += 1;
  return () => {
    locks -= 1;
    if (locks === 0) body.overflow = restore;
  };
}

// Bug scenario: Install opens, then Welcome opens (both lock), user taps
// "Later" (Install unmounts) then dismisses Welcome. Body must be scrollable.
const releaseInstall = lock();
const releaseWelcome = lock();
releaseInstall();
assert.strictEqual(body.overflow, "hidden", "still locked while Welcome open");
releaseWelcome();
assert.strictEqual(body.overflow, "", "scroll restored after last modal closes");

// Reverse close order must also restore.
const a = lock();
const b = lock();
b();
a();
assert.strictEqual(body.overflow, "", "restored regardless of close order");

console.log("ok");
