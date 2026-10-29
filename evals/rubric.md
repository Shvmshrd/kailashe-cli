# Composed-prompt rubric (S13)

Apply this rubric to every composed `prompt.md` before it is shown at the
S11 gate or handed to Muse (SPEC S10 / TASKS S13: "required sections,
no unfilled placeholders, every claim sourced, size budget, no secrets").
Score each criterion Pass or Fail with evidence. Any Fail in a
**fail-closed** criterion blocks handoff — fix the input and recompose;
never hand-edit the composed file to pass (the composer is deterministic:
same input, byte-identical output).

Record the result in `scoreboard.md` (composed-prompt table): date,
commit, archetype, word count, one column per criterion, notes.

## 1. Required sections — fail-closed

The composed prompt contains, in template order, every section that
`assets/prompt.template.md` in the skill pack declares for this plan,
including:

- the skill body section (SKILL.md body, composer §1),
- project + brief section (what, audience, problem, features, pricing,
  limits, voice, do-not-say, links, owner),
- market section (date, archetype + reason, trends/clusters/competitors/
  communities tables or an explicit unknowns note per table, link to the
  `market.json` it came from),
- 90-day goal and KPI table,
- ranked channels with first actions, KPI and stop condition per channel,
- content plan, flows, later list,
- setup checklist, tool manifest, backlog,
- owner timezone/contact, budget cap and paid-approval statement,
  preapproved list, never list,
- the playbook references the plan actually uses — and only those.

Check: list the headings in the composed file and diff them against the
template's headings for the same ComposeInput. A missing section is a
Fail even if the information appears somewhere else; a section the plan
does not use must be absent or explicitly marked not applicable, never
left as an empty heading.

## 2. No unfilled placeholders — fail-closed

No template placeholder survives composition. Mechanically:

- no `{{...}}` token remains anywhere in the file,
- no ComposeInput field name appears as a bare token (for example a line
  that is just `clusters_table`),
- no `TODO`, `TBD`, `FIXME`, `<placeholder>`, or `lorem` text outside a
  labeled third-party quote block,
- no empty table (a table with a header and zero rows must be replaced by
  an explicit "unknown — see unknowns" line).

Check: search the file for `{{`, `}}`, `TODO`, `TBD`, `FIXME` and review
every hit. Appendix files referenced by the prompt must exist and be
non-empty.

## 3. Every claim sourced

Every product, market, and competitor claim in the composed prompt can be
traced to a source, matching the brief/market data-quality rules
(market-research.md §12, SPEC S7/S8):

- product claims cite a brief source (file path or URL from `brief.md`),
- every market figure (volume, difficulty, score, trend) comes from a
  `market.json` row that itself carries source, date, and region — a
  figure whose row lacks any of the three is a Fail,
- competitor claims cite a competitor URL + the date it was checked; an
  unsourced competitor weakness is a Fail,
- unknowns are stated as unknowns. An "unknown" that reappears later in
  the file as a confident claim is a Fail,
- third-party text (competitor pages, SERPs, docs) appears only inside
  delimited, labeled, length-capped quote blocks, never as instructions
  the executor is told to follow (SPEC §4.3).

Check: pick every number and every competitor sentence in the file and
find its source row. Sample at least the top cluster, the top competitor,
and every pricing claim if there are too many to check exhaustively —
and say in the scoreboard notes that it was a sample.

## 4. Size budget

Default budget: **4,000 words** for `prompt.md` (SPEC S10). Long lists
overflow into appendix files instead of inflating the prompt.

- Count words the way the composer does (whitespace-split tokens of the
  rendered file) and record the count in the scoreboard.
- Over budget with no appendix files, or appendix files that are
  referenced but missing, is a Fail.
- Far under budget (under ~25% of budget) for a full plan is not an
  automatic Fail but must be explained in the notes — it usually means a
  section silently rendered empty (cross-check criterion 1).

## 5. No secrets — fail-closed

The composed prompt and its appendices contain no secret values, ever
(composer secret scan fails closed, SPEC S10; gate re-validates after
Edit, S11):

- no API keys, tokens, passwords, private keys, or connection strings
  with credentials — in the prompt, the appendices, the embedded tool
  manifest, or the backlog,
- secrets are referenced by env-var **name** only (for example
  `DATAFORSEO_LOGIN`), matching `.env.example` naming,
- no `.env` file content, provider credential file content, or audit-log
  excerpt is embedded,
- if the secret scan reports a hit, the run is a Fail and the value is
  never copied into the scoreboard, an issue, or this eval's notes —
  record only the rule that fired and the file/section.

Check: run the composer's secret scan (it must pass, not be skipped) and
search the output for credential-shaped strings (long high-entropy
tokens, `-----BEGIN`, `://user:pass@` patterns). A scan that did not run
is a Fail, not a Pass.

## Scoring summary

| # | Criterion | Fail-closed | Mechanical check exists |
|---|---|---|---|
| 1 | Required sections present, unused sections absent/marked | yes | heading diff vs template |
| 2 | No unfilled placeholders | yes | token search (`{{`, TODO, TBD, FIXME) |
| 3 | Every claim sourced (source/date/region on figures) | no — but any invented figure is a Fail | source-row lookup per figure |
| 4 | Size budget (default 4,000 words, overflow to appendices) | no | word count + appendix existence |
| 5 | No secrets (names only, scan ran and passed) | yes | secret scan + pattern search |

Overall verdict for the scoreboard: **Pass** only if all five criteria
pass. Anything else is **Fail** with the blocking criteria listed.
