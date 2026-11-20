import { test } from "node:test";
import assert from "node:assert";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const FORBIDDEN = ["·", "▸", "✦", "✧", "◆", "●", "▪", "➤", "»", "•", "★", "✪"];
const DIRS = ["src/scenes", "src/ui", "src/render"];

test("no decorative glyphs in user-facing UI strings", () => {
  const offenders = [];
  for (const dir of DIRS) {
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) {
      if (!f.endsWith(".js") || f.endsWith(".test.js")) continue;
      const lines = readFileSync(join(dir, f), "utf8").split("\n");
      lines.forEach((ln, i) => {
        if (ln.trim().startsWith("//")) return;
        for (const g of FORBIDDEN) {
          if (ln.includes(g)) offenders.push(`${dir}/${f}:${i + 1}  uses "${g}"`);
        }
      });
    }
  }
  assert.deepEqual(offenders, [], `Forbidden decorative glyph(s) in UI text — use words/spaces instead:\n${offenders.join("\n")}`);
});
