# Eval scoreboard

One row per run, appended chronologically. Never edit or delete a past
row — record a correction as a new row that references the old date.
No secrets anywhere in this file: accounts, keys, and providers are
named, never valued (env-var names only).

Thresholds: detector >=90% on app type, start command, and both combined
(`README.md`); composed prompt = all five rubric criteria pass
(`rubric.md`); deploy gym = HTTP 200 health check + clean logs 60s +
teardown confirmed (`deploy-gym.md`).

## Detector accuracy runs (`node evals/run-evals.mjs`)

| Date | Commit | Fixtures | App type | Start cmd | Both | Verdict | Notes |
|---|---|---|---|---|---|---|---|
| YYYY-MM-DD | `<short-sha>` | 30 generated (+11 golden in scan tests) | 0/30 (0%) | 0/30 (0%) | 0/30 (0%) | Pass/Fail | failing fixture names, follow-up test or fix |

## Composed-prompt runs (rubric.md, manual or scripted)

For manual Muse runs: compose the prompt, score it with `rubric.md`,
then record both the rubric result and what the Muse run produced.

| Date | Commit | Archetype | Words (budget 4,000) | Sections | Placeholders | Sourced claims | Secrets scan | Verdict | Notes |
|---|---|---|---|---|---|---|---|---|---|
| YYYY-MM-DD | `<short-sha>` | e.g. b2b-saas | 0 | Pass/Fail | Pass/Fail | Pass/Fail | Pass/Fail (scan ran: yes/no) | Pass/Fail | blocking criteria, Muse run outcome, prompt.md path |

## Deploy-gym runs (deploy-gym.md, sandbox accounts only)

| Date | Commit | App slot | Provider | Sandbox account | Success (200 + clean logs) | Steps | Retries / escalations | Model cost (USD) | Est. monthly cost (USD) | Time-to-URL | Teardown confirmed | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| YYYY-MM-DD | `<short-sha>` | A-E | e.g. fly | name only | yes/no | 0 | 0 / 0 | 0.00 (actual/estimate) | 0.00 | 0m 00s | yes/no | plan deviations, resources left behind (must be none) |

## How to add a row

1. Run the harness or review exactly as its document describes
   (`README.md`, `rubric.md`, or `deploy-gym.md`).
2. Append one row to the matching table with the real numbers from that
   run — copy percentages, counts, and costs from the run output, do
   not round a Fail into a Pass.
3. In Notes, name the follow-up for every Fail: the test added, the fix
   made, or the issue opened. A Fail with no follow-up is treated as
   untriaged at the next review.
