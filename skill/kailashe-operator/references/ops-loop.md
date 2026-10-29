# Ops loop: HQ, tasks, cadence, reports

Contents: 1 Project HQ, 2 Task schema, 3 Priority, 4 Cadence and scheduled tasks, 5 Approvals in practice, 6 Escalations, 7 Weekly report, 8 KPIs and UTMs, 9 Decision rules, 10 Session close, 11 Failure modes

## 1. Project HQ

Chats end and context gets lost. HQ is the single source of truth. The owner can read it any time.

Use Notion, or Google Docs plus Sheets. Name the root "<Project> HQ". Create:

| Page | Type | Holds |
|---|---|---|
| 00 Brief | doc | Product facts, audience, voice, links, pricing, do-not-say list. Owner edits. |
| 01 Plan | doc | Strategy, archetype, ranked channels, KPIs, budget cap, approval policy. |
| 02 Backlog | table | One row per task. Schema in section 2. |
| 03 Content calendar | table | Piece, keyword, intent, stage, dates, URL, results. |
| 04 Directory tracker | sheet | Directory, submit URL, submitted, status, listing URL, notes. |
| 05 Outreach CRM | sheet | Target, type, contact route, status, last touch, next step. |
| 06 Flows registry | table | Flow, tool, trigger, purpose, last run, alert target. |
| 07 Decisions | doc | Date, decision, reason, who decided. |
| 08 Reports | folder | Weekly and monthly reports. |
| 09 Learnings | doc | What worked and what did not, with evidence. |
| 10 Session log | doc | One entry per session: done, changed, waiting, next. |
| 11 Market | doc | Output of `references/market-research.md`. |

If no Notion or Google account is connected, end every report with a state block (brief summary, plan summary, open tasks, waiting approvals). Ask the owner to save it and paste it back to resume.

## 2. Task schema

Every backlog row has these fields:

```yaml
id: T-014
title: Submit to 10 relevant directories
goal: Ten listings live on relevant directories
channel: directories
route: muse-browser + gmail (verification emails)
approval: B
inputs: [listing-kit, directory-tracker]
steps: [prepare kit, submit in batches of 5, confirm emails, record URLs]
success_check: 10 tracker rows with status live and a listing URL
kpi: referring_domains
impact: 3        # 1 to 5
confidence: 4    # 1 to 5
effort: 3        # 1 to 5, lower is easier
depends_on: [T-003]
status: todo     # todo, doing, waiting-approval, blocked, done
evidence: []
notes: ""
```

## 3. Priority

score = (impact x confidence) / effort

Add 2 if the task unlocks three or more others. Subtract 2 if it needs an approval the owner has not answered for 3 days. Ties: pick the task with more evidence behind it.

Early weeks favor foundations: tracking, SEO basics, listing kit, first content, first directories. Do not start paid or cold outreach before the foundations are done.

## 4. Cadence and scheduled tasks

Create these as Muse scheduled tasks if you can. If not, ask the owner to set reminders. Name them "<Project>: ...". Scheduled tasks may read, research and save drafts to HQ. Publishing, sending and spending stay behind approval.

| When | Task | What it does |
|---|---|---|
| Weekday mornings | Daily run | Check inbox and mentions, log new items, run the top 1 to 3 backlog tasks, queue approvals. |
| Monday | Weekly plan | Refresh trends and rankings (`market-research.md` section 11), update priorities, post the week's plan. |
| Friday | Weekly report | Write the report (section 7) and send it to the owner. |
| 1st of the month | Monthly review | Content audit, directory status, tool access review, spend against cap, plan changes. |

## 5. Approvals in practice

- Class B batch: one table with item, destination, exact text or link, risk note. Ask: approve all, approve some, edit, skip.
- Class C: one message per action. What, where, exact content, why, what could go wrong, and what happens if the owner says nothing (default: nothing happens).
- Unanswered for 3 days: remind once, then drop the task's priority.
- Muse options: "Allow once" for class C. "Allow for this task" for a batch inside one run and for saves. Skip "Allow for this site" and "Always allow" on anything public.

## 6. Escalations

Use this format:

```
Blocked: <what>
Why it matters: <one line>
Options: A) ... B) ...
My pick: <A or B> because ...
If no answer: <default>
```

Escalate on: missing access, captcha or login wall, unclear community rule, tool misbehaving, cost above plan, results that contradict the plan.

Batch questions. At most one escalation message per session unless something is urgent.

## 7. Weekly report

Use this template:

```
# <Project> weekly report, <date range>

## Headline
One sentence: the most important thing that happened.

## KPIs
| Metric | Last week | This week | Target | Source |
|---|---|---|---|---|

## Shipped
- <item> | <evidence link>

## What I learned
- <finding> | <evidence>

## Blocked or waiting
- <item> | <who> | <since>

## Next week
- <top 3 to 5 tasks>

## Decisions I need
- <decision> | <my pick> | <default if no answer>

## Spend and tool usage
| Item | Used | Cap |
|---|---|---|

## Risks
- <risk> | <what I am doing about it>
```

Rules: every number has a source. Say "no data yet" when there is none. Do not round up. Do not call a trend a result.

## 8. KPIs and UTMs

Month 1, foundations: tracking live, pages indexed, listing kit ready, directory listings live, first content published, first referring domains.
Month 2, traction: impressions, clicks, qualified visits, community replies that led to visits, newsletter signups.
Month 3, conversion: signups, activations, paying customers, retention signals, cost per outcome.

Pick 3 to 5 KPIs that fit the archetype (`assets/archetypes.yaml`). Skip vanity metrics.

UTM convention for every link you post: `utm_source=<channel>&utm_medium=<format>&utm_campaign=<task id or piece slug>`. Keep a lowercase, hyphenated style. Log the final link with the task.

## 9. Decision rules

- Double down when a channel improves three weeks in a row against its own baseline.
- Stop or change tactic when a channel shows no signal after four weeks of consistent, quality effort. Write down why.
- Never scale volume to fix a quality problem.
- Ask before changing positioning, pricing, brand name, domain, or spend.
- When two options are close, pick the one that is easier to undo.

## 10. Session close

Before you stop:
1. Update backlog statuses and evidence.
2. Write the session log entry: done, changed, waiting, next.
3. List approvals waiting in one message.
4. If you could not reach HQ, output the state block.

A fresh chat must be able to resume from HQ alone.

## 11. Failure modes

| Problem | Do this |
|---|---|
| Connector dropped | Save state, tell the owner which connector, ask them to reconnect, continue with other tasks. |
| Owner is silent | Do class A work only. Queue the rest. Do not guess approvals. |
| Context too long | Write the state to HQ, then continue in a fresh chat from HQ. |
| Conflicting instructions | Follow the owner's latest direct message. Note the conflict in Decisions. |
| Tool returns odd data | Cross-check with a second source. Mark the number "unverified" until confirmed. |
| Three failures on one task | Stop. Escalate with what you tried. |
| Unexpected permission prompt | Do not approve. Tell the owner what asked and why it is unexpected. |
