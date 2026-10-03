const fs = require("fs");
const path = require("path");
const { test, assert } = require("./_lib");

// app.js is a browser script, so pull the two literals out of its source and
// evaluate them on their own.
const src = fs.readFileSync(path.join(__dirname, "../public/app.js"), "utf8");
function literal(name, open, close) {
  const start = src.indexOf("const " + name + " = " + open);
  assert.ok(start >= 0, name + " literal found");
  const end = src.indexOf("\n" + close + ";", start);
  assert.ok(end > start, name + " literal ends");
  const body = src.slice(start + ("const " + name + " = ").length, end + 1 + close.length);
  return new Function("return " + body)();
}
const ICONS = literal("ICONS", "{", "}");
const ICON_GROUPS = literal("ICON_GROUPS", "[", "]");
const GROUP_NAMES = [
  "Food & Drink", "Transport", "Shopping", "Home & Bills", "Health & Care", "Entertainment",
  "Games", "Travel", "Education & Work", "Family & Pets", "Money & Investments", "Others",
];

test("icons: 323 icons", () => {
  assert.strictEqual(Object.keys(ICONS).length, 323);
});
test("icons: 12 groups with the exact names and order", () => {
  assert.deepStrictEqual(ICON_GROUPS.map((g) => g.name), GROUP_NAMES);
});
test("icons: every icon is in exactly one group", () => {
  const seen = {};
  ICON_GROUPS.forEach((g) => g.ids.forEach((id) => { seen[id] = (seen[id] || 0) + 1; }));
  Object.keys(ICONS).forEach((id) => assert.strictEqual(seen[id], 1, id + " appears in " + (seen[id] || 0) + " groups"));
});
test("icons: every group id exists in ICONS", () => {
  ICON_GROUPS.forEach((g) => g.ids.forEach((id) => assert.ok(ICONS[id], id + " missing from ICONS")));
});
test("icons: every markup is a non-empty, script-free string", () => {
  Object.entries(ICONS).forEach(([id, m]) => {
    assert.strictEqual(typeof m, "string", id);
    assert.ok(m.trim().length > 0, id + " is empty");
    assert.ok(!/<script/i.test(m), id + " has <script");
    assert.ok(!/\son\w+\s*=/i.test(m), id + " has an on…= attribute");
  });
});
