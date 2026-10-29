#!/usr/bin/env node
/**
 * Detector-accuracy eval harness (S13, SPEC TASKS S13).
 *
 * Vitest-free, no dependencies, no network, no LLM.
 *
 * What it does:
 *   1. Requires the built detector: packages/scan/dist/index.js.
 *      If the packages are not built it prints "requires built packages"
 *      and exits 1 — it never tries to build or install anything itself.
 *   2. Materialises 30 minimal fixture repos in a fresh OS temp directory
 *      (nothing is written into fixtures/ or the repo) and removes the
 *      temp directory afterwards.
 *   3. Runs the deterministic detector on each fixture and compares
 *      appType and startCommand against the expected values below.
 *   4. Prints per-fixture results and the accuracy summary, and exits 1
 *      if app-type accuracy, start-command accuracy, or the combined
 *      (both fields right) accuracy is below 90%.
 *
 * Run it with:
 *   pnpm -r build && node evals/run-evals.mjs
 *
 * The 11 golden repos under fixtures/ stay covered by
 * packages/scan/test/detect.test.ts; this harness adds breadth (30
 * minimal variants) without growing the golden tree. See README.md.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const EVALS_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(EVALS_DIR, "..");
const DIST_ENTRY = path.join(REPO_ROOT, "packages", "scan", "dist", "index.js");
const THRESHOLD = 0.9; // >=90% on app type + start command (TASKS S13)

if (!fs.existsSync(DIST_ENTRY)) {
  console.error(
    "requires built packages: run `pnpm -r build` first " +
      `(missing ${path.relative(REPO_ROOT, DIST_ENTRY)}).`,
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 30 minimal fixture repos: [name, files, expectedAppType, expectedStart]
// Files are written verbatim into a temp dir; expectations are the values
// the deterministic detector is documented to produce for each shape.
// A null start command means "no server start command" (static sites,
// dockerfile-only images handled by their CMD where present).
// ---------------------------------------------------------------------------

function pkg(deps, scripts) {
  return JSON.stringify({ name: "eval-fixture", private: true, scripts, dependencies: deps }, null, 2) + "\n";
}

const FIXTURES = [
  // --- JavaScript / TypeScript frameworks (package.json driven) ---
  ["nextjs-basic", { "package.json": pkg({ next: "14.2.3", react: "18.3.1" }, { build: "next build", start: "next start" }) }, "nextjs", "npm start"],
  ["nextjs-no-react-dep", { "package.json": pkg({ next: "14.2.3" }, { start: "next start" }) }, "nextjs", "npm start"],
  ["vite-react", { "package.json": pkg({ vite: "5.4.0", react: "18.3.1" }, { build: "vite build", preview: "vite preview" }) }, "vite-spa", "npm run preview"],
  ["vite-vue", { "package.json": pkg({ vite: "5.4.0", vue: "3.4.0" }, { build: "vite build", preview: "vite preview" }) }, "vite-spa", "npm run preview"],
  ["vite-vanilla", { "package.json": pkg({ vite: "5.4.0" }, { build: "vite build", preview: "vite preview" }), "index.html": "<title>vite</title>\n" }, "vite-spa", "npm run preview"],
  ["astro-blog", { "package.json": pkg({ astro: "4.16.0" }, { build: "astro build", preview: "astro preview" }) }, "astro", "npm run preview"],
  ["astro-portfolio", { "package.json": pkg({ astro: "4.16.0" }, { build: "astro build", preview: "astro preview" }) }, "astro", "npm run preview"],
  ["remix-app", { "package.json": pkg({ "@remix-run/node": "2.9.0", "@remix-run/react": "2.9.0" }, { start: "remix-serve build" }) }, "remix", "npm start"],
  ["nuxt-app", { "package.json": pkg({ nuxt: "3.12.0" }, { build: "nuxt build", start: "node .output/server/index.mjs" }) }, "nuxt", "npm start"],
  ["sveltekit-app", { "package.json": pkg({ "@sveltejs/kit": "2.5.0", vite: "5.4.0" }, { build: "vite build", preview: "vite preview" }) }, "sveltekit", "npm run preview"],
  ["express-api", { "package.json": pkg({ express: "4.19.2" }, { start: "node src/index.js" }), "src/index.js": 'require("express")().listen(3000);\n' }, "express", "npm start"],
  ["express-with-db", { "package.json": pkg({ express: "4.19.2", pg: "8.12.0" }, { start: "node index.js" }), "index.js": 'require("express")().listen(3000);\n' }, "express", "npm start"],
  ["fastify-api", { "package.json": pkg({ fastify: "4.28.0" }, { start: "node server.js" }), "server.js": 'require("fastify")().listen(3000);\n' }, "fastify", "npm start"],
  ["nestjs-api", { "package.json": pkg({ "@nestjs/core": "10.3.0", "@nestjs/common": "10.3.0" }, { start: "node dist/main.js" }) }, "nestjs", "npm start"],

  // --- Plain static sites (no manifest, no start command by design) ---
  ["static-plain", { "index.html": "<title>Static</title>\n" }, "static", null],
  ["static-landing", { "index.html": "<title>Landing</title>\n<p>hi</p>\n" }, "static", null],

  // --- Python ---
  ["fastapi-main", { "requirements.txt": "fastapi==0.115.0\nuvicorn==0.30.0\n", "main.py": "from fastapi import FastAPI\napp = FastAPI()\n" }, "fastapi", "uvicorn main:app"],
  ["fastapi-app-entry", { "requirements.txt": "fastapi==0.115.0\nuvicorn==0.30.0\n", "app.py": "from fastapi import FastAPI\napp = FastAPI()\n" }, "fastapi", "uvicorn app:app"],
  ["django-basic", { "requirements.txt": "Django==5.0.6\n", "manage.py": "#!/usr/bin/env python\n# django entry\n" }, "django", "python manage.py runserver"],
  ["django-with-celery", { "requirements.txt": "Django==5.0.6\ncelery==5.4.0\n", "manage.py": "#!/usr/bin/env python\n# django entry\n" }, "django", "python manage.py runserver"],
  ["flask-app", { "requirements.txt": "Flask==3.0.3\n", "app.py": "from flask import Flask\napp = Flask(__name__)\n" }, "flask", "flask run"],
  ["flask-with-gunicorn", { "requirements.txt": "Flask==3.0.3\ngunicorn==22.0.0\n", "app.py": "from flask import Flask\napp = Flask(__name__)\n" }, "flask", "flask run"],

  // --- Ruby / Go ---
  ["rails-basic", { Gemfile: "source 'https://rubygems.org'\ngem 'rails'\n" }, "rails", "bundle exec rails server"],
  ["rails-api", { Gemfile: "source 'https://rubygems.org'\ngem 'rails'\ngem 'sidekiq'\n" }, "rails", "bundle exec rails server"],
  ["go-plain", { "go.mod": "module example.com/plain\n\ngo 1.22\n", "main.go": 'package main\n\nimport "net/http"\n\nfunc main() { _ = http.ListenAndServe(":8080", nil) }\n' }, "go", "go run ."],
  ["go-api", { "go.mod": "module example.com/api\n\ngo 1.22\n", "main.go": 'package main\n\nimport "net/http"\n\nfunc main() { _ = http.ListenAndServe(":9090", nil) }\n' }, "go", "go run ."],

  // --- Dockerfile shapes (app type is honestly "unknown" without a manifest) ---
  ["dockerfile-node", { Dockerfile: 'FROM node:20-alpine\nEXPOSE 8080\nCMD ["node", "server.js"]\n' }, "unknown", "node server.js"],
  ["dockerfile-nginx", { Dockerfile: 'FROM nginx:alpine\nEXPOSE 80\nCMD ["nginx", "-g", "daemon off;"]\n' }, "unknown", "nginx -g daemon off;"],

  // --- Manifest + Dockerfile (manifest wins for app type) ---
  ["express-docker", { "package.json": pkg({ express: "4.19.2" }, { start: "node index.js" }), Dockerfile: 'FROM node:20-alpine\nCMD ["node", "index.js"]\n', "index.js": 'require("express")().listen(3000);\n' }, "express", "npm start"],
  ["fastapi-docker", { "requirements.txt": "fastapi==0.115.0\nuvicorn==0.30.0\n", "main.py": "from fastapi import FastAPI\napp = FastAPI()\n", Dockerfile: 'FROM python:3.12-slim\nCMD ["uvicorn", "main:app"]\n' }, "fastapi", "uvicorn main:app"],
];

if (FIXTURES.length !== 30) {
  console.error(`eval fixture table must contain exactly 30 entries, found ${FIXTURES.length}.`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

const { detectProfile } = await import(pathToFileURL(DIST_ENTRY).href);
if (typeof detectProfile !== "function") {
  console.error("requires built packages: packages/scan/dist/index.js does not export detectProfile.");
  process.exit(1);
}

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kailashe-evals-"));
let appTypeOk = 0;
let startOk = 0;
let bothOk = 0;
const rows = [];

try {
  for (const [name, files, expectedAppType, expectedStart] of FIXTURES) {
    const dir = path.join(tmpRoot, name);
    for (const [rel, content] of Object.entries(files)) {
      const full = path.join(dir, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content, "utf-8");
    }
    const profile = await detectProfile(dir);
    const gotAppType = profile.appType.value;
    const gotStart = profile.startCommand.value;
    const appOk = gotAppType === expectedAppType;
    const cmdOk = gotStart === expectedStart;
    if (appOk) appTypeOk += 1;
    if (cmdOk) startOk += 1;
    if (appOk && cmdOk) bothOk += 1;
    rows.push({ name, expectedAppType, gotAppType, expectedStart, gotStart, appOk, cmdOk });
  }
} finally {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
}

for (const r of rows) {
  const mark = r.appOk && r.cmdOk ? "PASS" : "FAIL";
  console.log(
    `${mark} ${r.name}: appType=${r.gotAppType} (expected ${r.expectedAppType}); ` +
      `start=${JSON.stringify(r.gotStart)} (expected ${JSON.stringify(r.expectedStart)})`,
  );
}

const n = FIXTURES.length;
const pct = (x) => `${((100 * x) / n).toFixed(1)}%`;
console.log("");
console.log(`Detector accuracy on ${n} generated fixtures (threshold ${(THRESHOLD * 100).toFixed(0)}% each):`);
console.log(`  app type:      ${appTypeOk}/${n} = ${pct(appTypeOk)}`);
console.log(`  start command: ${startOk}/${n} = ${pct(startOk)}`);
console.log(`  both fields:   ${bothOk}/${n} = ${pct(bothOk)}`);

if (appTypeOk / n < THRESHOLD || startOk / n < THRESHOLD || bothOk / n < THRESHOLD) {
  console.error("FAIL: detector accuracy below the 90% S13 threshold.");
  process.exit(1);
}
console.log("PASS: detector accuracy at or above the 90% S13 threshold.");
