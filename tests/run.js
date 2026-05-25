/* Minimal test runner: requires every tests/*.test.js, awaits queued async
   tests, reports totals. */
const fs = require("fs");
const path = require("path");

(async () => {
  const dir = __dirname;
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".test.js"));
  let total = 0, failed = 0;
  for (const f of files) {
    process.stdout.write("\n=== " + f + " ===\n");
    const before = { t: total, f: failed };
    global.__counts = { add(p) { total++; if (!p) failed++; } };
    global.__pending = [];
    try {
      require(path.join(dir, f));
      await Promise.all(global.__pending);
    } catch (e) {
      failed++;
      console.error("THREW:", e && e.stack || e);
    }
    process.stdout.write(`  (+${total - before.t} run, +${failed - before.f} failed)\n`);
  }
  console.log(`\n${total - failed}/${total} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
