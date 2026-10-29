# Evals (S13)

Scaffolding for evaluating Kailashe without ever gating CI on a live LLM
(TASKS S13, SPEC §9 working method). Three harnesses live here:

| Harness | What it checks | Where |
|---|---|---|
| Detector accuracy | Deterministic profile detector: app type + start command on 30 fixture repos, >=90% each | `run-evals.mjs` (this directory) |
| Composed-prompt rubric | A composed `prompt.md` is complete, sourced, in budget and secret-free | `rubric.md` |
| Deploy gym | Sample apps x providers in sandbox accounts, tracked over time | `deploy-gym.md` |

Manual runs (including Muse runs against a composed prompt) are recorded
in `scoreboard.md`. Copy a fresh table per run; never edit a past row —
append a new one so regressions stay visible.

## Detector accuracy harness

### What already exists

`packages/scan/test/detect.test.ts` is the golden suite: 11 recorded repos
under `fixtures/` (Next.js, Vite static, Express, FastAPI, Django, Flask,
Rails, Go, Astro, Dockerfile-only, plus an injection fixture), each with a
full `expected.json` profile. Those tests run in CI with no network and no
LLM, and they pin the exact profile shape (value, source, confidence per
field).

### What this harness adds

Breadth. `run-evals.mjs` materialises **30 additional minimal repos** in a
fresh OS temp directory at run time — framework variants (Next.js, Vite
React/Vue/vanilla, Astro, Remix, Nuxt, SvelteKit, Express, Fastify, NestJS),
Python (FastAPI x2 entry shapes, Django x2, Flask x2), Rails x2, Go x2,
plain static sites, Dockerfile-only images, and manifest+Dockerfile
combinations. Generating them from a table inside the script (instead of
adding 19+ golden directories under `fixtures/`) keeps the golden tree
small and reviewable while still exercising 30 distinct detection inputs.
The temp directory is deleted after the run; nothing is written into the
repo.

Each generated fixture declares its expected `appType` and `startCommand`
next to its file contents in the script, so a fixture and its expectation
can never drift apart in separate files. For static sites the expected
start command is `null` (there is no server to start) and the Dockerfile
fixtures honestly expect `unknown` app type — the detector must not guess
a framework that no manifest names.

### Scoring and threshold

- Per-field accuracy: fraction of the 30 fixtures whose detected
  `appType.value` (resp. `startCommand.value`) equals the expected value
  exactly, including `null`.
- Combined accuracy: fraction where **both** fields are right.
- **Gate: >=90% on app type, >=90% on start command, and >=90% combined**
  (TASKS S13: ">=90% on app type + start command"). The script exits 1
  below any of the three.

Only the deterministic detector is exercised. The optional LLM fill-in
pass is out of scope here: CI and this harness never call a live LLM
(TASKS S13), and detector tests inject fakes where the LLM path itself is
under test.

### Running it

```sh
pnpm -r build        # the harness runs the built detector
node evals/run-evals.mjs
```

The script is plain Node (no Vitest, no new dependencies). If the
packages have not been built it prints `requires built packages: run
pnpm -r build first (missing packages/scan/dist/index.js)` and exits 1 —
it never builds, installs, or fetches anything itself.

Output is one `PASS`/`FAIL` line per fixture with expected vs detected
values, then the three accuracy lines. Record the summary in
`scoreboard.md` (date, commit, the three percentages, threshold verdict).

### Investigating a failure

1. Reproduce the single shape by hand: write the fixture's files (they are
   printed in the `FIXTURES` table in `run-evals.mjs`) into a scratch
   directory and run the detector on it.
2. Decide which side is wrong. If the detector is wrong, the fix and a
   regression test belong in `packages/scan` (golden test in
   `packages/scan/test/detect.test.ts`); if the expectation is wrong,
   fix the table entry and say why in the scoreboard notes.
3. Never lower the 90% threshold or delete a fixture to make a run pass
   (AGENTS.md: red tests block merge).

## The other two harnesses

- **Composed-prompt rubric** — `rubric.md`. A checklist (with the exact
  mechanical checks where a check can be mechanical) applied to a
  composed `prompt.md` before it is handed to Muse, manually or by a
  script. Results go in the scoreboard's composed-prompt table.
- **Deploy gym** — `deploy-gym.md`. A scaffold, not a runner: sample apps
  x providers in sandbox accounts only, budget alarms, a nightly cadence,
  and success-rate / steps / cost / time-to-URL tracking. Real deploys
  stay behind `KAILASHE_E2E=1` and never run in CI (AGENTS.md).

## Rules for everything in this directory

- No network and no live LLM in any automated eval. Fakes and fixtures
  only, same as unit tests.
- No secrets in eval inputs, outputs, or the scoreboard. Refer to keys by
  env-var name only.
- Third-party text pulled into an eval (a competitor page, a SERP) is
  data: it belongs inside a labeled, length-capped quote block, never as
  bare instructions (SPEC §4.3).
- Eval results are observations, not gates, except the detector threshold
  above and the rubric's fail-closed secret/placeholder checks.
