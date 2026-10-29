import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const here = path.dirname(fileURLToPath(import.meta.url));
// @kailashe/core has no package exports upstream; alias its source so tests
// that import it directly still resolve without editing that package.
const coreSrc = path.resolve(here, "../core/src");
const planSrc = path.resolve(here, "../plan/src");

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@kailashe\/core\/exit-codes(?:\.js)?$/, replacement: path.join(coreSrc, "exit-codes.ts") },
      { find: /^@kailashe\/core$/, replacement: path.join(coreSrc, "index.ts") },
      // channel-map.ts is standalone (no imports) in @kailashe/plan; alias its
      // source so validate-pack tests run without a prior plan build.
      { find: /^@kailashe\/plan\/channel-map(?:\.js)?$/, replacement: path.join(planSrc, "channel-map.ts") },
    ],
  },
  test: {
    include: ["test/**/*.test.ts"],
  },
});
