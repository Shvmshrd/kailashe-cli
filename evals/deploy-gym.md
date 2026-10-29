# Deploy gym scaffold (S13)

A scaffold for exercising real deploys repeatedly — sample apps x
providers, in sandbox accounts only — so deploy reliability is measured
instead of assumed (TASKS S13: "sample apps x providers in sandbox
accounts, budget alarms, nightly, tracks success rate, steps, cost,
time-to-URL"). This document defines the gym; it is not a runner. Real
runs stay behind `KAILASHE_E2E=1` with real accounts and never run in CI
(AGENTS.md: `pnpm test:e2e` needs `KAILASHE_E2E=1` and real accounts,
never in CI).

## 1. Sample apps

Pick small, boring, known-good apps — one per detector shape the deploy
agent must handle. Reuse repos the project already trusts where possible
(the golden fixtures under `fixtures/` are detection fixtures, not
deployable apps; give each gym app a real start command and a health
path).

| Slot | App shape | Why it is in the gym |
|---|---|---|
| A | Static site (build-dir artifact) | Cheapest path; exercises static upload, no server |
| B | Node API (Express/Fastify, container or repo artifact) | The common case; exercises build + start + health check |
| C | Python API (FastAPI) | Non-Node toolchain; exercises image build |
| D | App + database + cache (compose-shaped profile) | Resource hints; exercises multi-resource plans and tagging |
| E | Dockerfile-only app | Detector low-confidence path; exercises questions + image flow |

Each gym app records, in its own repo: expected provider shortlist per
SPEC F2.2 preselection, health path, expected monthly cost band, and the
teardown command. An app whose expectations change gets a new row in the
scoreboard, not a silent edit.

## 2. Providers and sandbox accounts

- Providers: the v0.1 registry (`aws`, `digitalocean`, `vercel`,
  `cloudflare`, `fly` — `providers/*.yaml`). AWS only when the gym run
  names it, per SPEC F2.2; static apps never target AWS in v0.1 (F2a).
- **Sandbox accounts only.** One sandbox account/project per provider,
  used for nothing else. No production account, no personal production
  project, no shared billing project with real workloads — ever.
- Kailashe never reads provider credential files (SPEC §5): each sandbox
  is authenticated with the provider's own CLI login on the gym machine,
  exactly like a user machine. Keys for the gym live in the gym
  machine's environment / `.env` (names only in this repo, per
  `.env.example`); nothing secret is written into this directory, the
  scoreboard, or state files.
- Every resource a gym run creates is tagged `kailashe-project={{id}}`
  (SPEC F2.6) with a gym-specific project id, and teardown removes
  tagged resources only, through the safe runner, with approval.

## 3. Budget alarms

Two independent budgets guard every gym run (SPEC §2.2, S8):

- **Model budget** — `KAILASHE_MODEL_BUDGET_USD` (default USD 3 per
  command run; warn at 80%, hard stop at 100%, exit 7). Gym runs set it
  explicitly per run and record the value in the scoreboard.
- **Provider spend** — each sandbox account gets a provider-side budget
  alarm (billing alert) at 50% / 80% / 100% of the monthly gym cap, set
  in the provider console before the first run. The 100% alarm pages the
  gym owner; a fired 80% alarm pauses nightly runs until a human looks.
- **Per-run cap** — a gym run also declares a max expected cost before
  it starts (from the app's cost band). A deploy plan whose monthly cost
  estimate exceeds the band is rejected at the plan gate, not after
  resources exist.
- Market research inside a gym run obeys the normal market budget guard:
  `KAILASHE_MARKET_BUDGET_USD` unset means no paid market calls, full
  stop (SPEC F3.4).

Alarm configuration is verified (screenshot or console link, date) in
the scoreboard notes before the first nightly run on a new sandbox
account. "We think alarms are on" is not verification.

## 4. Nightly cadence

- **Nightly, unattended-read-only by default:** detector eval
  (`evals/run-evals.mjs`), unit tests, and a dry-run deploy plan for each
  app x provider cell. Dry runs create nothing.
- **Weekly, attended:** one real deploy per app x provider cell on a
  rotating schedule, run by a human (or a supervised agent session) who
  approves the plan, watches verification (HTTP 200 on the health path,
  clean logs 60s, SPEC F2.7), records the run, and tears down.
- **Never in CI:** real deploys, real provider CLIs against real
  accounts, and anything needing `KAILASHE_E2E=1`. CI runs unit tests,
  fake-CLI transcripts, and this directory's deterministic harness only.
- A failed nightly dry run or weekly deploy opens a scoreboard Fail row
  the same day; two consecutive failures in one cell pause that cell
  until the cause is understood.

## 5. What every run tracks

Per run, appended to `scoreboard.md` (deploy-gym table):

- date, commit, app slot, provider, sandbox account (name only),
- **success** — live URL returned HTTP 200 on the health path and logs
  were clean for 60s (yes/no; partial deploys count as failures with a
  note),
- **steps** — number of deploy-agent steps and number of retries
  (escalations after 3 retries count separately),
- **cost** — model spend for the run (USD, from the client's usage
  accounting; labeled an estimate if the endpoint reported no usage)
  plus the plan's monthly resource cost estimate,
- **time-to-URL** — wall clock from confirmed plan to first HTTP 200,
- teardown confirmed (tagged resources removed) and any resource left
  behind (must be none; anything left is a Fail row of its own).

Rolling aggregates worth reviewing monthly, per app x provider cell:
success rate (target: trending up; investigate any cell under 80% over
the last 10 runs), median steps, median retries, median cost per run,
median time-to-URL. The gym exists to make these numbers boring.

## 6. Safety rules that do not bend

- Sandbox accounts only; production is never a gym target.
- All cloud CLI calls go through the core safe runner (allowlist,
  redaction, audit) — the gym gets no bypass, no `shell: true`, no
  hand-run provider commands outside the runner (SPEC §4.2, AGENTS.md).
- Plan approval before any create/modify/delete, per run, every run —
  familiarity is not approval.
- Secrets never appear in gym logs, state, transcripts, or the
  scoreboard; the seeded-secret property from S4 applies to gym output
  too.
- Teardown is part of the run. A run without a confirmed teardown is
  unfinished, and its cost keeps accruing against the sandbox cap.
