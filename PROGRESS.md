# Kailashe — Progress

## G0 — SPEC + TASKS approval

- Date: 2026-10-29
- Status: approved by owner directive to build start-to-finish without questions
- Files: `docs/SPEC.md` (Q1–Q12 incorporated), `TASKS.md` (S0–S15)

---

## Implementation run — 2026-10-29 (parallel agents, integrated by lead)

Built by parallel sub-agents, each owning one package directory, then integrated
and verified centrally. Branch: `slice/s0-foundations`.

**Final verification: `pnpm build` ✓ · `pnpm typecheck` ✓ · `pnpm lint` ✓ ·
`pnpm test` ✓ — 535 tests, 0 failures.** Breakdown: core 166, deploy 119,
scan 85, cli 55, compose 44, plan 30, market 25, mcp 11. Safety greps: no
`shell: true` anywhere; no `any` in sources. Smoke: `kailashe --version`
0.1.0, `kailashe doctor` ok, `kailashe validate-pack` ok on the real pack,
evals detector accuracy 30/30 (100%, threshold 90%).

### Slice reports (Appendix B, condensed)

- **S0 Foundations** — pnpm workspace (8 packages), TS strict, CI 3-OS,
  exit codes §2.5 with typed errors, 13 Zod schemas + JSON Schema exports
  (`packages/core/src/schemas`), `LLMClient` (Meta Model API, 429 backoff,
  $3/run budget → exit 7, contributor gate), `FakeLLM`, validate-pack.
  Deps added, exact-pinned: `zod-to-json-schema@3.24.1` (ISC, permissive;
  3.25.x targets Zod v4 and breaks on pinned zod 3.23.8),
  root `eslint@8.57.1` + `@typescript-eslint/*@7.18.0` (MIT; required by
  every package lint script/.eslintrc, was missing).
- **S1 init** — installs pack to `.agents/skills` + `.claude/skills`,
  AGENTS.md pointer, `--dry-run`, SHA-256 hash-diff (no overwrite of user
  edits without `--force`), idempotent. 6 tests.
- **S2 detector** — deterministic pass + LLM fill-only-missing (injected
  client), `{value,source,confidence}` per field, 11 golden fixtures incl.
  injection fixture byte-identical to benign. 85 scan tests total.
- **S3 providers** — 5 registry YAMLs validated against Provider schema
  (AWS image-only per F2a), loader invariants, always-ask choice UX
  (AWS never preselected), injected bootstrap (absolute path, refuses
  project/node_modules binaries, credential-never-read proof). 32 tests.
- **S4 safe runner** — execa args-array only, per-provider allowlist,
  risk classes, sanitized PATH, redaction, append-only audit, red-team
  suite. 113 runner tests within core.
- **S5 deploy agent** — tool loop (7 tools), fetch_docs allowlist +
  labeled untrusted blocks, plan approval enforced before create/modify/
  delete dispatch, 3-retries-then-escalate, recipe replay, injection test.
  119 deploy tests total.
- **S6 build/domain/CI** — image-build, Registrar (Cloudflare) with typed
  price confirmation, domain command, deploy-on-merge workflow gen.
  Covered in deploy suite.
- **S7 scanner+brief** — project digest/SEO/brief (pre-existing, verified;
  85 scan tests with S2).
- **S8 market** — adapters, budget guard (unset → no paid calls +
  unknowns + enabling line), exact scoring formula, clustering. 25 tests.
- **S9/S9b/S9c plan** — archetype/channel ranking/backlog priority
  `(impact×confidence)/effort`, manifest capability validation, checklist,
  HQ CSV templates (5), directories vet/import/listing-kit. S9c Q7: list
  licenses unverifiable offline → **no rows copied**; importer + empty
  seed shipped (stop-and-ask item for owner, see below). 30 tests.
- **S10 composer** — template render, SKILL §1 inline, 4,000-word budget
  + appendix, deterministic, lint fail-closed (placeholders/secrets),
  third-party text only in labeled capped blocks, 9-archetype snapshots,
  injection test. 44 tests.
- **S11 gate UX** — ≤12-line summary, Execute/Edit/Quit, mocked
  clipboard/editor tests, `--yes`/`--json`, exits 3/6 per §2.5. CLI 55.
- **S12 MCP** — stdio server, 3 read + 3 write tools; write tools act
  only with `confirm:true` (proven by call counts + in-memory client
  test). SDK pinned `@modelcontextprotocol/sdk@1.17.0`; this package
  uses `zod@3.25.76` because SDK 1.17 requires the `zod/v3` subpath.
- **S13 evals** — detector harness 30/30, rubric.md, deploy-gym.md,
  scoreboard.md. CI never gated on a live LLM.
- **S14 docs** — README 5-command quickstart, CONTRIBUTING, SECURITY
  (threat model incl. trusted-CLI assumption), PRIVACY (egress table,
  Meta terms linked, not paraphrased).
- **S15** — SPEC §10 only. No code, as specified.

### Addendum 2026-10-29 — Modal + Cloudflare Workers, E2E run

- New providers: `providers/modal.yaml` (Modal CLI: `modal deploy` create,
  `modal token new` login, `modal profile current` verify) and
  `providers/cloudflare-workers.yaml` (Workers-only wrangler patterns,
  distinct from Pages-focused `cloudflare`). Registry now 7 providers.
- Choice UX: Python/GPU serverless → Modal preselected; small edge JS/TS
  (no DB) → Cloudflare Workers preselected; AWS still never preselected.
- Tests: 549 green (deploy 133, +14). New `evals/e2e-local.mjs` harness
  (detect → registry/choice → allowlist → plan → gate → MCP handlers):
  18/18 PASS. Detector evals 30/30. Live smokes: `init` into temp dir
  (19 written, second run 0), `validate-pack` ok, MCP stdio `initialize`
  handshake ok. No real provider accounts used; deploys remain
  plan-approved through the runner.

### Open items for owner (gates, per build prompt)
- **G1–G4 human reviews** not yet signed off (code complete; review pending).
- **S9c Q7**: verify ai-directories / OpenLaunch LICENSEs online; if
  permissive, import rows with attribution + `THIRD_PARTY.md`.
- **S5 start-of-slice re-verification** of AWS ECS Express Mode CLI verbs
  against live AWS docs (offline here; allowlist follows SPEC F2a).
- **E2E** (`pnpm test:e2e`, `KAILASHE_E2E=1`, real accounts) never run.

<!-- Slice reports appended per Appendix B after each slice -->
