// Reads the shipped artifact directly. There is no build, so the values
// asserted here are the values that ship — no second copy to drift.
import { readFileSync } from "node:fs";

const HTML_PATH = new URL("../index.html", import.meta.url);

export function readHtml() {
  return readFileSync(HTML_PATH, "utf8");
}

export function readTokens() {
  const css = readHtml().match(/<style>([\s\S]*?)<\/style>/)[1];
  const root = css.match(/:root\s*\{([\s\S]*?)\n\s*\}/)[1];
  return Object.fromEntries(
    [...root.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map(m => [m[1], m[2].trim()])
  );
}

// The app script guards its own bootstrap with `typeof document !== "undefined"`,
// so evaluating it here defines every function and runs no DOM code.
export function loadApp() {
  const src = readHtml().match(/<script id="app-script">([\s\S]*?)<\/script>/)[1];
  const exports = `return {
    createSeedData, isOverdue, rankAttentionTasks, filterRecords,
    setState: v => { state = v; }, getState: () => state
  };`;
  return new Function(`${src}\n${exports}`)();
}
