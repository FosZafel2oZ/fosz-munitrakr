const assert = require("node:assert/strict");

// Each call to test() queues a promise on global.__pending. The runner awaits
// the queue between files so async tests are reported in order and the final
// pass/fail count is accurate.
function test(name, fn) {
  if (!global.__pending) global.__pending = [];
  const p = (async () => {
    let passed = false;
    try {
      await fn();
      passed = true;
      process.stdout.write("  ✓ " + name + "\n");
    } catch (e) {
      process.stdout.write("  ✗ " + name + "\n    " + (e && e.message || e) + "\n");
    }
    if (global.__counts) global.__counts.add(passed);
  })();
  global.__pending.push(p);
}

module.exports = { test, assert };
