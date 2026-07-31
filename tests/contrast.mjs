import assert from "node:assert/strict";
import { readTokens } from "./harness.mjs";

const srgb = h => h.replace("#", "").match(/../g).map(x => parseInt(x, 16) / 255);
const lin = c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const lum = h => { const [r, g, b] = srgb(h).map(lin); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

const t = readTokens();
const CANVAS = t["--canvas"];
const SURFACE = t["--surface"];

// Text tones must clear AA on BOTH backgrounds they can appear on.
const TEXT = ["--ink", "--muted", "--faint", "--brand", "--pass", "--warn", "--fail", "--info"];
// Bounds of actual controls carry the 3:1 obligation (WCAG 1.4.11).
const CONTROL = ["--rule-control"];
// Fills are never text. Asserted only to be perceptible against the surface.
const FILL = ["--pass-fill", "--warn-fill", "--fail-fill"];

let failures = 0;
const check = (name, got, floor, against) => {
  const ok = got >= floor;
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(16)} ${got.toFixed(2).padStart(6)} : 1  on ${against} (need ${floor})`);
};

for (const name of TEXT) {
  assert.ok(t[name], `token ${name} missing from :root`);
  check(name, ratio(t[name], CANVAS), 4.5, "canvas");
  check(name, ratio(t[name], SURFACE), 4.5, "surface");
}
for (const name of CONTROL) {
  assert.ok(t[name], `token ${name} missing from :root`);
  check(name, ratio(t[name], SURFACE), 3, "surface");
}
for (const name of FILL) {
  assert.ok(t[name], `token ${name} missing from :root`);
  check(name, ratio(t[name], SURFACE), 1.5, "surface");
}

// The doctrine, asserted: brand and state must never share a value.
for (const s of ["--pass", "--warn", "--fail", "--info"]) {
  assert.notEqual(t[s], t["--brand"], `${s} must not equal --brand (spec 4.1)`);
}

assert.equal(failures, 0, `${failures} contrast failure(s)`);
console.log("\nAll contrast pairs pass.");
