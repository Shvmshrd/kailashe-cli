# Market research playbook

Contents: 1 Output, 2 Inputs, 3 Frame, 4 Trends, 5 Keywords, 6 SERPs, 7 Competitors, 8 Communities, 9 Prioritize, 10 Rank channels, 11 Refresh, 12 Data quality rules

## 1. Output

One page in HQ called "Market", plus a JSON block at the end. Sections: audience, archetype, trend findings, keyword clusters, SERP gaps, competitors, communities, channel ranking, first 10 targets, risks, sources with dates.

The Kailashe CLI may already have produced a first draft inside your prompt. Reuse it, keep its date, and refresh anything older than 30 days.

## 2. Inputs

Brief, live URL, repo summary, target regions and languages, price point, who pays. If one is missing, infer it, mark it "assumed", and ask the owner in the next batch.

## 3. Frame

1. Pick the archetype from `assets/archetypes.yaml`. Note why.
2. Write the ICP in three lines: who they are, the problem they search for, what they use today.
3. List jobs-to-be-done as phrases a real person types. 10 to 20 seeds. Mix three kinds: problem words ("how to ..."), tool words ("... alternative", "... vs ..."), outcome words.
4. List 3 to 8 competitors and alternatives, direct and indirect.

## 4. Trends

Goal: learn whether demand is rising, seasonal, steady or fading, and where it is strongest.

Sources, in order:
1. Google Trends API (alpha), if the owner has access. Consistent scaling across requests, 5-year window.
2. A managed Trends endpoint the owner has keys for, for example DataForSEO's Google Trends explore, or SerpApi.
3. The Trends website in your browser, for spot checks. It rescales 0 to 100 per request and compares only a few terms, so never compare numbers across separate requests.
4. Trend data the CLI attached to your prompt. Cite its date.

Run for the 10 best seed terms:
- 5-year interest over time. Label the shape: rising, steady, seasonal, fading, or spike.
- Rising related queries and topics for the last 12 months.
- Regional split. Note the top 5 regions and any gap between where interest is and where the product can serve (language, payments, law).
- Head to head against 3 to 5 competitors or alternatives.
- Seasonality: the highest and lowest 2 months, so content ships 4 to 8 weeks before a peak.

Rules:
- Trends data is relative interest. It is not search volume. Never quote it as visits or searches.
- A rising query on a tiny base is noise until the SERP shows real demand (section 6).
- News spikes fade. Build evergreen pages first. Build spike pages only if you can publish within days.
- Record for each finding: term, source, date range, region, finding, confidence.

## 5. Keywords

Expand each seed into 30 to 100 candidates. Sources:
- Keyword APIs the owner has: DataForSEO, Semrush, Ahrefs, SE Ranking. Use related keywords, suggestions and "questions" endpoints.
- Search suggestions and People Also Ask, from the SERP.
- Competitors' top pages and the queries they rank for.
- Questions on Reddit, forums and Q&A sites (from search, no scraping behind logins).
- Search Console queries, once the live site has data.

For each keyword collect: monthly volume (estimate), difficulty (the tool's scale, note which), cost per click if shown, trend shape, intent, SERP type, top competing page.

Intent labels:
- Informational: how-to, what is, examples.
- Commercial: best, top, vs, alternatives, reviews.
- Transactional: pricing, buy, sign up, free trial, download.
- Navigational: brand terms. Ignore unless it is your own brand.

Cluster by meaning and by SERP overlap. If two keywords show nearly the same top results, they belong to one page. One primary keyword per page prevents cannibalization.

## 6. SERPs

For the head term of each cluster (top 15 clusters), read the top 10 results:
- Format: article, list, tool, video, forum, product page, docs.
- Intent match and freshness (dates).
- Who ranks: big brands, small sites, forums, thin pages. Forums and thin pages mean a winnable gap.
- Structure: headings, length, tables, media, FAQs.
- SERP features: People Also Ask, video, shopping, AI answer boxes.
- The gap in one sentence: what is missing, stale or wrong. That gap is the angle of your page.

If the SERP is all giant brands with strong pages, move on. A new site wins on narrow, specific, helpful pages first.

## 7. Competitors

For each competitor note: positioning line, audience, pricing, strongest pages, content cadence, where they get links and mentions, and what users complain about (reviews, forums).

Output two lists:
- Differentiators you can say honestly, backed by the brief.
- Opportunities: "alternatives to X" pages, "X vs you" pages, migration guides, integrations pages, complaints you solve.

Competitor claims need a source URL and a date. Never state a competitor weakness you cannot link to.

## 8. Communities

Find where the audience already talks: subreddits, forums, Discords, Slack groups, newsletters, podcasts, YouTube channels, directories, directories of directories, Q&A sites, GitHub topics.

For each, record: name and link, size and activity, rules summary (self-promotion, links, disclosure), tone, best format, who the active voices are, and a fit score from 1 to 5.

Skip places where promotion is banned and the owner has no standing. Participation comes first, promotion later.

## 9. Prioritize

Score each keyword cluster:

score = intent_fit x product_fit x log10(volume + 10) / (difficulty + 10)

- intent_fit and product_fit: 0 to 3 each. Product fit means the product genuinely solves the query.
- Use the same difficulty scale for every row.

Pick the first 10 targets:
- 3 or more bottom-of-funnel: alternatives, comparisons, "best X for Y", pricing, use cases.
- 4 to 5 middle-of-funnel: how-to guides, templates, free tools, calculators, tutorials that use the product.
- 1 to 2 top-of-funnel or trend pieces, only if the trend is real.
- Favor low difficulty, clear intent, weak SERP, strong product fit.

For a new domain, avoid head terms. Win the long tail first and build topical depth around one cluster before starting another.

## 10. Rank channels

Rank channels for the first 30 days. Inputs: the archetype's default order, trend regions, community fit scores, and effort.

For each of the top 4 channels write: why this channel, the first three actions, the KPI, and the stop condition. Put the rest in a "later" list with a trigger ("after 20 indexed pages", "after first 100 users").

Paid channels stay off unless the owner sets a budget and approves.

## 11. Refresh

Weekly (light, Monday run):
- Trend check on the top 10 terms. Flag a shape change.
- Rankings and queries from Search Console and your rank tool for published pages.
- New competitor pages and launches.
- New relevant threads in the top communities.
- Update the backlog. Note what changed in the Market page.

Monthly (full):
- Redo keyword expansion on the best 3 clusters.
- Re-read the SERPs for target keywords.
- Re-score and re-prioritize.
- Retire or merge pages that cannibalize.

## 12. Data quality rules

- Every figure carries source, date and region. No source means no figure.
- Label estimates as estimates. Keyword volumes are modeled, not counted.
- Do not mix tools' difficulty scores. Pick one scale per table.
- If a tool fails or returns thin data, say so. Do not fill gaps with guesses.
- Store raw pulls in a sheet and link them. The summary is only as good as its trail.
- Keep a short "what I could not find" list. The owner decides if it is worth paying for better data.

JSON block at the end of the Market page:

```json
{
  "date": "YYYY-MM-DD",
  "archetype": "b2b-saas",
  "icp": "...",
  "trends": [{"term": "", "shape": "rising", "source": "", "range": "", "region": "", "confidence": "medium"}],
  "clusters": [{"name": "", "primary_keyword": "", "intent": "commercial", "volume": 0, "difficulty": 0, "score": 0, "gap": ""}],
  "competitors": [{"name": "", "url": "", "positioning": "", "pricing": ""}],
  "communities": [{"name": "", "url": "", "rules": "", "fit": 0}],
  "channels_ranked": [{"channel": "", "why": "", "kpi": "", "stop_if": ""}],
  "first_targets": [""],
  "unknowns": [""]
}
```
