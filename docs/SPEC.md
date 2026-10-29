# Kailashe — Specification

Status: DECISIONS INCORPORATED (Q1–Q12, owner, 2026-10-29) — awaiting G0 approval to start S0.
Date: 2026-10-29
Source of truth for the operate half: `skill/kailashe-operator/` (canonical path, §2.1).

## 1. Goals and non-goals

### 1.1 Goals

- G1. An open source (MIT) CLI, stdio MCP server, and skill pack that takes an AI-built project from "runs locally" to "live URL" and then to "operated as a side business" (market research, plan, composed `prompt.md` for Muse).
- G2. Deploy to a user-chosen provider (first: AWS, DigitalOcean, Vercel, Cloudflare, Fly) using that provider's own CLI and the user's own logged-in account. Kailashe never handles provider credentials.
- G3. Operate half driven by the existing skill pack: scan → market research → archetype plan → backlog → tool manifest → checklist → composed `prompt.md`.
- G4. Safe by construction: allowlisted subprocess runner, redaction, audit log, approval gates for anything paid, destructive, public, or hard to undo.
- G5. Everything local-first. State in `.kailashe/`; `prompt.md` at project root. No telemetry. Users bring their own keys via `.env`.

### 1.2 Non-goals

- NG1. Hosting, storing, or proxying user credentials, accounts, or apps.
- NG2. A hosted/cloud version, a web UI, or multi-user/team features.
- NG3. Executing the business plan itself from the CLI — Muse (via `prompt.md`, later the S15 connector) is the executor.
- NG4. Building the Muse connector (S15 is spec-only).
- NG5. Defaulting to any LLM tier whose provider may use the data to improve its products (§2.2 contributor gate).
- NG6. GUI installers; distribution is `npx kailashe`.

## 2. Source material and fixed decisions

### 2.1 The skill pack (read in full, 2026-10-29)

**Canonical path: `skill/kailashe-operator/` (Q1).** In the first S0 commit: `git init`, move `kailashe-operator/` → `skill/kailashe-operator/`, delete the loose root copies (hash-identical, verified 2026-10-29), and commit that move on its own. After S0, the pack is not edited without an explicit task.

| File | Consumed by | Contract extracted |
|---|---|---|
| `SKILL.md` | Host agents; composer (S10) | Operating rules, work loop, routing rules, approval classes A/B/C/Never. Its body (`Start of every session` → `Style of your output`) is inlined into `prompt.md` §1. |
| `assets/prompt.template.md` | Composer (S10) | Placeholders are the `ComposeInput` contract (§6.12). ~4,000-word budget; no secrets; only used playbooks included. |
| `assets/archetypes.yaml` | Planner (S9) | 9 archetypes: `dev-tool`, `b2b-saas`, `b2c-app`, `ai-tool`, `content-media`, `ecommerce`, `local-service`, `digital-product`, `free-utility`. Fields: `detect[]`, `channels_ranked[]`, `content_mix{bottom,middle,top,proof}`, `first_30_days[]`, `flows[]` (ids → tool-hubs §7), `kpis[]`, `cautions[]`. |
| `assets/connectors.yaml` | Manifest builder (S9) | `version: 1`, `verified: 2026-10-13`. `status_values`: live/custom/hub/browser/manual. Hubs: zapier, composio, activepieces, n8n, direct-api, browser. Capabilities (capability-id → routes[{via, tool, status, class, note?}]), each capability maps to an approval class A/B/C. |
| `references/market-research.md` | Market module (S8); Muse weekly refresh | Steps §§3–11; scoring formula §9; `market.json` shape at end (§6.6). Data-quality rules §12: every figure carries source, date, region. |
| `references/content-engine.md`, `channels.md` | Composer (S10) | Included in `prompt.md` §9 only when the plan uses them. Channel ids in `archetypes.yaml` are **labels** (Q6) — not checked against `channels.md`; the channel map lives in `packages/plan` (§6.13). `channels.md` §2 references a CLI-supplied directory list (input to S9c). |
| `references/tool-hubs.md` | Composer (S10); Muse | Manifest schema §4 (§6.9); starter flows §7 (15 flow ids); adding-a-tool §5; cost caps §8 (`monthly_cap_usd`, 80%/100% stop). |
| `references/ops-loop.md` | Composer (S10); Muse | HQ layout §1 (pages 00–11); Task schema §2 (§6.8); priority formula §3 `(impact × confidence)/effort`, +2/−2 modifiers; report format §7; UTM §8. |

The pack implies schemas without defining them formally; S0 makes them explicit Zod schemas with exported JSON Schema.

### 2.2 Fixed stack and LLM access (Q2, verified)

TypeScript strict, Node LTS, pnpm workspaces, exact-pinned versions. Libraries: Zod, Vitest, execa, commander, `@clack/prompts`, official MCP TypeScript SDK, Playwright. Any addition needs a written justification (license, maintenance, size) in the slice report.

One `LLMClient` interface; no package calls an LLM SDK directly. `FakeLLM` replays scripted transcripts for tests.

**Meta Model API — verified against Meta's official docs only, 2026-10-29** (third-party pages ignored; one lists a different host — disregarded):

| Fact | Value | Source (accessed 2026-10-29) |
|---|---|---|
| Base URL | `https://api.meta.ai/v1` | https://dev.meta.ai/docs/quickstart |
| API key | Exported as `MODEL_API_KEY`; `Authorization: Bearer $MODEL_API_KEY` | https://dev.meta.ai/docs/quickstart |
| Default model | `muse-spark-1.3` (set by `KAILASHE_MODEL`) | https://dev.meta.ai/docs/quickstart |
| Endpoint | Responses API: `POST /v1/responses`; OpenAI SDK `client.responses.create({ model, input })` with `baseURL: 'https://api.meta.ai/v1'` | https://dev.meta.ai/docs/quickstart |
| Standard mode | Meta states: "In Standard mode, you pay standard prices and your content is not used to train Meta models." | https://dev.meta.ai/docs/pricing-rate-limits |
| Contributor mode | Same model, discounted: call `muse-spark-1.3-contributor`. Meta states contributor content — prompts, code, files, context, and responses — may be used to train future Meta models. | https://dev.meta.ai/docs/pricing-rate-limits ; https://dev.meta.ai/help/policies-and-privacy/contributor-tier |
| Rate limits | Per team (not per key), per model. At verification: muse-spark-1.3 = 3,000 RPM / 4,000,000 TPM; contributor variants = 150 RPM / 3,000,000 TPM. Limits change — read them as indicative, not contractual. | https://dev.meta.ai/docs/pricing-rate-limits ; https://dev.meta.ai/help/usage-and-limits/rate-limits |
| 429 handling | Honor `Retry-After`; exponential backoff with jitter starting ~500 ms, doubling per consecutive 429. | https://dev.meta.ai/docs/pricing-rate-limits |

Rules:

- **Default is Standard (`muse-spark-1.3`).** Contributor (`muse-spark-1.3-contributor`) is allowed only when `KAILASHE_ALLOW_CONTRIBUTOR_TIER=1`, and every such run prints a warning that the contributor tier's data may be used to improve Meta's products.
- We make **no claim about Meta's retention or training on the standard tier beyond what Meta's own terms state** (quoted row above). `PRIVACY.md` (S14) links Meta's terms instead of paraphrasing them.
- Base URL and model stay configurable (`KAILASHE_LLM_BASE_URL`, `KAILASHE_MODEL`), so any OpenAI-compatible endpoint works, including a local open-weights model.
- `LLMClient` handles 429s with the backoff above at the client layer; a budget-exhausted or rate-limit-giving-up failure surfaces as exit 7 / a clear error, never a silent retry loop.
- **Model budget (Q8):** `KAILASHE_MODEL_BUDGET_USD`, default **USD 3 per command run**. Warn at 80%, stop at 100% (exit 7). Usage accrues from API usage fields; when the endpoint reports no usage, estimate from token counts and label it an estimate.

### 2.3 Repository layout (target, created in S0)

```
AGENTS.md  TASKS.md  PROGRESS.md  docs/SPEC.md
skill/kailashe-operator/        # the existing pack (§2.1)
providers/*.yaml                # provider registry
packages/{core,deploy,scan,market,plan,compose,cli,mcp}
fixtures/  evals/
```

### 2.4 Repo, git, CI (Q11)

- S0 runs `git init`. `.gitignore`: `node_modules`, `.env`, `.kailashe/`, `dist`. MIT `LICENSE` at root.
- Conventional commits. Branches: `slice/<id>-<name>` (e.g. `slice/s0-foundations`). One slice, one branch.
- `.github/workflows/ci.yml` runs on Linux, macOS, Windows: `pnpm install | build | typecheck | lint | test`. `pnpm test:e2e` needs `KAILASHE_E2E=1` and real accounts. Never in CI.
- The owner creates the GitHub repo and pushes; agents do not.

### 2.5 Exit codes (Q10 — locked for v0.1, tested in S0)

| Code | Meaning |
|---|---|
| 0 | ok |
| 1 | unexpected error |
| 2 | usage error (bad flags/args) |
| 3 | needs input, or approval denied |
| 4 | provider auth failed |
| 5 | deploy failed or partial |
| 6 | validation failed |
| 7 | budget exceeded (model budget §2.2, market budget §8/S8) |
| 130 | interrupted (SIGINT) |

## 3. User flows

### F1. Install / init

1. When the user runs `npx kailashe init` in a project, the system shall install the pack to `.agents/skills/kailashe-operator/` and `.claude/skills/kailashe-operator/`, add a short pointer to `AGENTS.md` (creating it if missing), support `--dry-run`, never overwrite user edits without `--force`, and be idempotent on a second run.

### F2. Deploy (S1–S6)

1. When the user asks to deploy, the system shall detect the project profile (S2) and show what it found, with low-confidence fields as questions.
2. **Provider choice: always ask (Q3).** The system shall preselect one recommendation from the profile and mark it as such, and shall never act without confirmation:
   - static site or SSR front end → recommend **Vercel or Cloudflare** (pick one, say why);
   - a container with a database → recommend **DigitalOcean**;
   - **AWS only if the user names it** — never the preselected default.
3. When the user picks a provider, the system shall check for that provider's CLI, print the exact OS install command (only from sources listed in the provider YAML, §5), and run it only after confirmation.
4. When the CLI is present but unauthenticated, the system shall run the provider login with inherited stdio, re-print the login URL/code, then run the provider's verify command. The system shall never read provider credential files.
5. When deploy starts, the deploy agent shall present a plan (resources, exact commands, monthly cost, rollback) and shall not run any create/modify/delete command before explicit approval.
6. When a create succeeds, the system shall record resource ids (tagged `kailashe-project={{id}}`) to `.kailashe/deploy-state.json` immediately.
7. When deploy finishes, the system shall verify HTTP 200 on the health path and report URL, resources, cost estimate, and the teardown command.
8. When the user runs `kailashe teardown`, the system shall remove only tagged resources, through the runner, with approval.
9. When a deploy succeeds, the system shall save a recipe and offer replay on the next deploy, falling back to the agent only when a step fails.

### F2a. AWS in v0.1 (Q4) — image-only

- **No App Runner** (closed to new customers 2026-04-30). **No raw Fargate assembly. No EC2.** Static sites go to Vercel or Cloudflare, not AWS.
- The agent builds the image, pushes it to **ECR**, then deploys via **ECS Express Mode** (needs a container image and two IAM roles; it deploys images, not source) or **Lightsail container services** for small apps. It picks one from the profile and says why, in the plan (F2.5).
- IAM role/policy calls are risk class `iam-billing-network` and always ask (approval per call class, §4.2).
- Exact allowlist patterns (prefix patterns; the runner matches binary + subcommand prefix, args are never shell-interpreted). AWS-CLI syntax for Express Mode verbs must be re-verified against AWS docs in S5 and any correction recorded in the slice report:

  | Pattern | Class | Notes |
  |---|---|---|
  | `aws sts get-caller-identity` | read | verify step |
  | `aws ecr describe-repositories`, `aws ecr describe-images` | read | |
  | `aws ecr create-repository` | create | tagged |
  | `aws ecr get-login-password` | iam-billing-network | output is a credential: piped by the runner directly to the registry login's stdin, redacted everywhere, never logged, never sent to the model |
  | `aws ecs describe-express-*`, `aws ecs describe-services`, `aws ecs describe-tasks` (exact verbs per S5 doc check) | read | |
  | `aws ecs create-express-*`, `aws ecs update-express-*` (exact verbs per S5 doc check) | create/modify | plan approval required |
  | `aws ecs delete-express-*` (exact verb per S5 doc check) | delete | teardown only, approval required |
  | `aws lightsail get-container-services`, `aws lightsail get-container-service-deployments` | read | |
  | `aws lightsail create-container-service`, `aws lightsail push-container-image`, `aws lightsail create-container-service-deployment` | create | tagged where the API supports it; else recorded in deploy-state |
  | `aws lightsail delete-container-service` | delete | teardown only |
  | `aws iam get-role`, `aws iam list-roles`, `aws iam list-attached-role-policies` | read | |
  | `aws iam create-role`, `aws iam create-policy`, `aws iam attach-role-policy`, `aws iam put-role-policy`, `aws iam pass-role` (via ECS/Lightsail calls) | iam-billing-network | always ask, per call |
  | `aws logs describe-log-groups`, `aws logs get-log-events`, `aws logs filter-log-events` | read | 60 s clean-log check |
  | `aws ec2 *`, `aws ecs create-cluster` (raw Fargate assembly), `aws ecs register-task-definition`, `aws apprunner *` | — | **denied in v0.1** (not on the allowlist) |

  Equivalent per-provider pattern tables for `digitalocean`, `vercel`, `cloudflare`, `fly` are written into their `providers/*.yaml` in S3 and extended only via an allowlist-change task (stop-and-ask).

### F3. Operate / "Run this side project?" (S7–S11)

1. When deploy succeeds (or on demand), the system shall ask "Run this side project?" On "no", it shall stop cleanly.
2. On "yes", the system shall scan the project (S7 → `brief.md`, every claim sourced), run market research (S8 → `market.json`, budgeted, sourced), pick the archetype/playbook (S9, user-overridable), build the tool manifest and setup checklist, and write `prompt.md` at the project root (S10).
3. When `prompt.md` is ready, the system shall show a ≤12-line summary and offer Execute / Edit / Quit (S11). Edit opens `$EDITOR` and re-validates. Execute copies to the clipboard, prints the path, opens the configured Muse URL, and prints the readiness checklist.
4. When any API key is missing, the system shall not crash; it shall emit an "unknowns" list and a clearer setup checklist instead. When `KAILASHE_MARKET_BUDGET_USD` is unset, the system shall make **no paid market calls** (Q8): it emits the unknowns list plus the one line that enables them ("Set `KAILASHE_MARKET_BUDGET_USD=<amount>` in `.env` to enable paid market research; free sources were used where possible.").

### F4. MCP (S12)

1. When an MCP client calls a read tool (`detect_project`, `list_providers`, `status`), the system shall answer without side effects.
2. When a client calls a write tool (`deploy`, `scan_business`, `build_prompt`), the system shall return a plan first and shall not act without an explicit confirmation argument.

## 4. Architecture

| Package | Owns | Key slices |
|---|---|---|
| `packages/core` | Zod schemas + JSON Schema export, safe runner (allowlist, risk classes, redaction, audit, trusted-CLI hardening §5), `LLMClient`/`FakeLLM`, `.kailashe/` state, `validate-pack` | S0, S4 |
| `packages/scan` | Deterministic profile detector + LLM fill-in; project scanner → `brief.md` | S2, S7 |
| `packages/deploy` | Provider registry loader, CLI bootstrap, deploy agent loop, recipes, `Registrar` interface + Cloudflare impl, image build, CI workflow gen | S3, S5, S6 |
| `packages/market` | Trends/keywords/SERP provider interfaces + adapters, budget guard, clustering/scoring → `market.json` | S8 |
| `packages/plan` | Archetype selection, **channel map (§6.13)**, channel ranking, backlog gen, manifest builder, checklist, HQ templates (S9b), directories/listing kit (S9c) | S9, S9b, S9c |
| `packages/compose` | `prompt.md` composer (template render, includes, word budget, secret scan, deterministic) | S10 |
| `packages/cli` | commander CLI: `init`, `doctor`, `validate-pack`, `deploy`, `teardown`, `domain add`, gate UX, `--version`; exit-code mapping (§2.5) | S0, S1, S6, S11 |
| `packages/mcp` | stdio MCP server, tools in F4 | S12 |

Cross-package rule: one agent owns one package directory; contract changes (schema/SPEC/consumers) land in one PR reviewed by the lead.

### 4.1 LLMClient

```ts
interface LLMClient {
  respond(input: LLMRequest): Promise<LLMResponse>;
}
```

Default impl: OpenAI SDK → Meta Model API (§2.2). `FakeLLM` for tests. Built into the client: 429 backoff (§2.2), model-budget accounting (Q8, exit 7), contributor-tier gate (§2.2). No other package calls an LLM SDK directly. LLM calls are metered per command run.

### 4.2 Safe runner (core, S4 — highest scrutiny)

- execa with args array; **never `shell: true`** anywhere (grep-enforced).
- Per-provider allowlist: binary + subcommand patterns (§F2a and `providers/*.yaml`). Risk classes: `read | create | modify | delete | iam-billing-network`, each with its own approval prompt. Timeouts, output caps.
- Secret redaction applied to every output path (logs, model, audit, state) before the text leaves the runner.
- Append-only audit log `.kailashe/audit.jsonl` (redacted), including the resolved absolute CLI path + version for every provider call (§5).
- All cloud CLI calls in all packages go through this runner. No exceptions.

### 4.3 Untrusted-text rule (all packages)

Third-party text (web pages, provider docs, SERPs, competitor sites, repo files, tool results) is data, never instructions. It enters prompts only inside delimited, labeled, length-capped quote blocks. This rule is tested in S2, S5, S7, S10 with canned injection fixtures.

## 5. Security model

- **Credentials:** provider creds stay in each provider CLI's own store. Kailashe never reads credential files, never logs/echoes secret values, passes secrets by reference (provider secret stores, env names only). User keys live in `.env` (gitignored); `.env.example` lists names only. The one runner-mediated credential flow is ECR login (§F2a), piped process-to-process and redacted everywhere.
- **Trusted provider CLIs (Q9):** provider CLI binaries are **trusted** once installed — that assumption is stated in `SECURITY.md`. Cheap hardening still applies: sanitized `PATH` for subprocesses; each CLI resolved to an absolute path at bootstrap, with path + version logged in the audit log; binaries inside the project directory or `node_modules` refused; installs only from sources listed in the provider YAML.
- **Approvals:** runner risk classes (deploy side) and pack approval classes A/B/C/Never (operate side) are never weakened by config. Spend, deletes, IAM/billing/network, domain purchase, first community posts, cold outreach always require explicit per-action confirmation (domain purchase: typed confirmation, S6).
- **Injection:** §4.3 plus a red-team suite (≥30 malicious command strings: separators, substitution, redirects, path tricks, encoded payloads) in S4; injection fixtures in S2/S5/S7/S10.
- **Secrets egress:** composer secret-scans `prompt.md` and fails closed (S10); gate re-validates after Edit (S11); property test in S4 proves a seeded secret appears in no output path.
- **Threats in scope:** malicious repo content, malicious fetched docs/pages, compromised tool output, accidental secret logging, command injection via LLM-generated commands. **Out of scope:** a compromised provider CLI binary itself (trusted, above), a compromised host OS.

## 6. Schemas (S0 delivers Zod + exported JSON Schema for each)

Field lists are extracted from the pack; S0 may add `id`/versioning fields only via a schema-change task.

1. **Profile** (S2): app type, stack/framework, artifact kind (image/build dir/repo), ports, build cmd, start cmd, env var names, resource hints (db, cache, object storage, queue, cron), static|dynamic. Every field: `{ value, source, confidence }`; low confidence → question.
2. **Provider** (`providers/*.yaml`, S3): id, name, cli binary, install commands per OS (with source URLs), login cmd, verify cmd, docs domains (allowlist), allowed binaries/subcommand patterns + risk classes (§F2a form), health/tagging conventions.
3. **DeployPlan**: resources[], exact commands[], monthly cost estimate, rollback commands[], doc URL+date per step. Shown and approved pre-flight.
4. **DeployState** (`.kailashe/deploy-state.json`): project id, provider, resource ids (tagged), URL, timestamps, step log; updated after each create.
5. **Recipe**: provider, app type, artifact kind, commands, docs date. Replay first; agent fallback on failure.
6. **Market** (`market.json`, market-research.md): `date, archetype, icp, trends[{term, shape, source, range, region, confidence}], clusters[{name, primary_keyword, intent, volume, difficulty, score, gap}], competitors[{name, url, positioning, pricing}], communities[{name, url, rules, fit}], channels_ranked[{channel, why, kpi, stop_if}], first_targets[], unknowns[]`. Scoring (§9 of the playbook): `score = intent_fit × product_fit × log10(volume+10) / (difficulty+10)`, fits 0–3, one difficulty scale.
7. **Plan**: archetype + reason, 90-day goal, KPIs, ranked channels (why, first 3 actions, KPI, stop condition), content plan, flows, later list.
8. **Task** (ops-loop §2): `id (T-NNN), title, goal, channel, route, approval (A|B|C), inputs[], steps[], success_check, kpi, impact 1–5, confidence 1–5, effort 1–5, depends_on[], status (todo|doing|waiting-approval|blocked|done), evidence[], notes`. Priority: `(impact × confidence)/effort` (+2 unlocks ≥3 others; −2 approval unanswered 3 days).
9. **Manifest** (tool-hubs §4): `project, budget{monthly_cap_usd, per_action_cap_usd}, capabilities[{id, route, allowed[], class, cost?, notes?}]`. Every entry's `id` must exist in connectors.yaml; never wildcard or admin actions.
10. **ConnectorsRegistry**: the connectors.yaml shape in §2.1 (version, verified date, hubs, capabilities→routes, approval classes).
11. **Archetypes**: the archetypes.yaml shape in §2.1 (9 archetypes).
12. **ComposeInput**: every placeholder in prompt.template.md — `project{name, url, repo}`, `date`, `plan.version`, `brief{what, audience, problem, features, pricing, limits, voice, donotsay, links, owner}`, `market{date, archetype, archetype_reason, trends_table, clusters_table, gaps, competitors_table, communities_table, unknowns, json_ref}`, `goals.ninety`, `kpi_table`, `channels_ranked`, `content_plan`, `flows`, `later_list`, `checklist`, `tool_manifest_yaml`, `hubs_in_use`, `backlog_yaml`, `owner{tz, contact}`, `budget{cap, paid}`, `preapproved`, `never`, `playbooks_included`.
13. **ChannelMap** (`packages/plan`, Q6): channel id → playbook section (file + heading). Channel ids in `archetypes.yaml` are labels; they are validated against this map, **not** against `channels.md`.

`validate-pack` (Q6): hard fail on dangling flow ids (archetype `flows[]` → tool-hubs §7), dangling capability ids (manifest/connectors cross-refs), missing required fields, and — once the channel map exists (S9; registered in S0 as a known check) — an archetype channel id missing from the channel map. `--lenient` downgrades these to warnings for local use only; **never in CI**. The pack itself is never edited to make validation pass.

## 7. Data egress (must stay accurate; mirrored in PRIVACY.md, S14)

| Destination | What leaves the machine | Authorized by |
|---|---|---|
| Meta Model API (or configured OpenAI-compatible base URL) | Redacted command output, fetched docs excerpts (quote-blocked), repo digest/profile | `MODEL_API_KEY` in `.env`; contributor tier only per §2.2 gate |
| Provider clouds (via their CLIs) | App artifact/image, config, resource creates per approved plan | User's own CLI login |
| Market data APIs (DataForSEO, SerpApi; later Semrush/Ahrefs/Trends alpha) | Seed terms, keywords, URLs queried | User's keys in `.env`; **no paid calls while `KAILASHE_MARKET_BUDGET_USD` is unset** (F3.4) |
| Fetched doc/web pages (S5 `fetch_docs`, S7 screenshots) | Outbound GET only; domains allowlisted for provider docs | Provider registry |
| Clipboard + Muse URL (S11) | `prompt.md` content, only on Execute | User pressing Execute |
| Cloudflare Registrar API (S6, only when asked) | Domain search/registration, price confirmed by typing | User request + typed price confirmation |
| Nowhere else | No telemetry, no analytics, no crash reports | — |

## 8. Reliability, privacy, degradation, output

- Commands idempotent or guarded; every long step resumable from `.kailashe/` state; timeouts + bounded retries (deploy agent: 3 retries per step, then escalate; LLM: §2.2 backoff).
- No telemetry. `PRIVACY.md` (§7 + Meta link per §2.2) stays accurate or the slice does not ship.
- Missing keys never crash: produce `unknowns[]` + clearer checklist. Unset market budget: F3.4. Model budget: §2.2 (warn 80%, stop 100%, exit 7). Market budget when set: estimates before calls, stops at cap (exit 7).
- Terse terminal text. No emoji. Color optional. Exit codes per §2.5.

## 9. Human gates and working method

| Gate | After | Owner does |
|---|---|---|
| G0 | This SPEC + TASKS.md | Approve / amend → S0 starts |
| G1 | S4 (safe runner) | Review red-team results before any deploy code |
| G2 | S5 (deploy agent) | Review transcripts + E2E smoke plan |
| G3 | S10 (composer) | Review a real composed `prompt.md` |
| G4 | Before any release | Approve release notes, SECURITY.md, PRIVACY.md |

Method (build prompt): one slice, one branch (`slice/<id>-<name>`, §2.4), one fresh session starting from `AGENTS.md` + the relevant SPEC section + the slice entry; plan first; test first (failing tests from acceptance criteria, then smallest passing code, then refactor); typecheck+lint+tests green or stop — never delete/weaken a test to pass; external-API behavior verified from official docs with URL+date in the slice report; separate-context review after each slice (spec conformance, security, test quality, simplicity; findings by severity; blockers fixed); commit, update `TASKS.md` + `PROGRESS.md`, slice report (build-prompt Appendix B). Stop-and-ask triggers: ambiguous requirement, schema change, new dependency, anything touching credentials, the runner allowlist, or the skill pack; or 3 failed attempts at the same problem.

## 10. S15 (spec-only, do not build)

A future Muse connector: remote MCP server with OAuth 2.1 + PKCE, a client metadata document, tools classed read / write / sensitive-write, a local agent with an outbound connection for deploy jobs, and the Muse submission package. Only the S15 SPEC section is written; no code.

## 11. Decisions log (owner, 2026-10-29 — Q1–Q12 resolved)

- **Q1 Path:** canonical `skill/kailashe-operator/`; S0 first commit = git init + move + delete hash-identical root duplicates, committed on its own.
- **Q2 LLM:** §2.2 (verified 2026-10-29). Standard default; contributor only with `KAILASHE_ALLOW_CONTRIBUTOR_TIER=1` + printed warning; no retention/training claims beyond Meta's terms; PRIVACY.md links the terms; 429 = per-team, backoff; base URL + model configurable.
- **Q3 Provider choice:** always ask; preselect per F2.2; AWS never preselected.
- **Q4 AWS:** F2a (image-only; ECR → ECS Express Mode or Lightsail; no App Runner/Fargate assembly/EC2; IAM class always-ask; exact allowlist in §F2a).
- **Q5 Registrar:** Cloudflare only at launch, behind a `Registrar` interface, **off unless the user asks**. The Registrar API is in beta — S6 verifies status and TLD coverage from Cloudflare's docs (URL+date in the slice report) before building on it. Typed price confirmation.
- **Q6 validate-pack:** §6 (hard fail; channel map in `packages/plan`; `--lenient` local-only, never CI; pack never edited).
- **Q7 Directories:** use the two lists tested in `lexmount/artifact-site` (**ai-directories** and **OpenLaunch**). S9c task 1: read each list's LICENSE and record it in this SPEC (§11 amendment). Permissive → import with attribution + `THIRD_PARTY.md`. Unclear/restrictive → copy no rows; ship an importer + empty seed. Always: drop dead links, link farms, pay-to-list.
- **Q8 Budgets:** unset market budget ⇒ no paid market calls (F3.4); `KAILASHE_MODEL_BUDGET_USD` default USD 3/run, warn 80%, stop 100% (§2.2).
- **Q9 Provider CLIs:** trusted + hardening (§5); assumption stated in SECURITY.md.
- **Q10 Exit codes:** §2.5, locked for v0.1, tested in S0.
- **Q11 Git/CI:** §2.4; owner creates the GitHub repo and pushes.
- **Q12 Owners (roles; names to be filled by owner):** Agent engineer — S0, S1, S4, S5, S12. Infra engineer — S2, S3, S6, S13. Integrations engineer — S7, S8, S9, S9b, S9c, S10, S11. S14 — docs. The lead reviews every gate.

### Open items carried into slices (not blocking G0)

- AWS Express Mode CLI verbs: re-verify against AWS docs in S5 (§F2a).
- Cloudflare Registrar beta status/TLD coverage: verify in S6 (Q5).
- Directory-list licenses: read + record in S9c task 1 (Q7).
- Meta limits/pricing: re-check at S5 start; docs change (§2.2).
