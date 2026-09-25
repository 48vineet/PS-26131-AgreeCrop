/* One runnable check for the three locale files. Fails on a key that exists in
   en but not in hi/mr, a key that only hi/mr have, a non-string value, or a
   {{placeholder}} that does not survive translation. Run with `npm run check:i18n`. */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const LOCALES_DIR = join(dirname(fileURLToPath(import.meta.url)), "../src/i18n/locales");
const SOURCE = "en";
const TARGETS = ["hi", "mr"];

const flatten = (object, prefix = "") =>
  Object.entries(object).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;

    if (value && typeof value === "object" && !Array.isArray(value)) {
      return flatten(value, path);
    }

    return [[path, value]];
  });

const load = (locale) =>
  flatten(JSON.parse(readFileSync(join(LOCALES_DIR, `${locale}.json`), "utf8")));

const placeholders = (value) =>
  typeof value === "string" ? (value.match(/\{\{[^}]+\}\}/g) || []).sort() : [];

const source = new Map(load(SOURCE));
const problems = [];

for (const locale of TARGETS) {
  const target = new Map(load(locale));

  for (const [key, value] of source) {
    if (!target.has(key)) {
      problems.push(`${locale}: missing "${key}"`);
      continue;
    }

    if (typeof target.get(key) !== "string") {
      problems.push(`${locale}: "${key}" is not a string`);
      continue;
    }

    const expected = placeholders(value).join(",");
    const actual = placeholders(target.get(key)).join(",");

    if (expected !== actual) {
      problems.push(
        `${locale}: "${key}" placeholders differ (en: ${expected || "none"}, ${locale}: ${actual || "none"})`,
      );
    }
  }

  for (const key of target.keys()) {
    if (!source.has(key)) problems.push(`${locale}: extra "${key}" not in ${SOURCE}`);
  }
}

if (problems.length) {
  console.error(`${problems.length} locale problem(s):\n${problems.map((line) => `  ${line}`).join("\n")}`);
  process.exit(1);
}

console.log(`i18n OK — ${source.size} keys in ${[SOURCE, ...TARGETS].join(", ")}`);
