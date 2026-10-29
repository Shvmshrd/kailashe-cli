# Content engine playbook

Contents: 1 Principles, 2 Content types, 3 Pipeline, 4 Brief template, 5 Drafting rules, 6 On-page SEO checklist, 7 Publishing by pull request, 8 Indexing, 9 Distribution kit, 10 Measure and refresh, 11 Volume guardrails, 12 Safety

## 1. Principles

- Write for the reader's task first. Search is the delivery channel, not the goal.
- Fewer, better pages. Google's spam policies treat mass-produced pages made mainly to rank as scaled content abuse. Using AI to help is not the problem. Low value at scale is.
- Every piece carries one original element that a competitor page lacks: real product screenshots, real numbers from the product, a tested workflow, a template, a benchmark, a founder's point of view.
- Product claims come from the brief and the repo. Nothing else.
- The owner is the author. Keep their voice from the brief.

## 2. Content types

| Funnel stage | Types | Goal |
|---|---|---|
| Bottom | Alternatives pages, comparisons, "best X for Y", pricing explainers, use-case pages, integrations pages | Capture people ready to choose |
| Middle | How-to guides, tutorials that use the product, templates, free tools, calculators, checklists | Show the product solving the problem |
| Top | Trend explainers, data stories, glossaries | Earn attention and links, only when the trend is real |
| Proof | Case studies, changelogs, build-in-public posts, benchmarks | Build trust |
| Docs | Getting started, API reference, FAQs | Reduce friction, rank for brand and how-to queries |

Start from the first 10 targets in the Market page.

## 3. Pipeline

Brief, draft, fact-check, edit, optimize, visuals, review, publish, index, distribute, measure, refresh.

Track each piece as a row in the Content calendar with its stage. Move one piece at a time to the review step. Do not leave twenty half-done drafts.

## 4. Brief template

```
Title working: 
Primary keyword: 
Secondary keywords (3 to 6): 
Search intent: informational | commercial | transactional
Reader: who, what they know, what they want to do next
Angle (from the SERP gap): 
Original element: 
Outline: H1, then H2 and H3 list in the reader's own words
Questions to answer (from People Also Ask and forums): 
Product facts to use (from the brief): 
Sources to cite (URL and date): 
Internal links to add (3 or more, with anchor text): 
Pages that should link to this one (2 or more): 
Call to action: one, honest, relevant
Schema: Article | SoftwareApplication | other
Success check: indexed, impressions by week 4, position goal by week 8
```

## 5. Drafting rules

- Answer first. Put the direct answer in the first 100 words, then go deeper.
- Use headings that match how people phrase the question. Short paragraphs. Concrete examples. Tables when comparing things.
- Show, do not claim. Prefer a screenshot, a number or a step-by-step over an adjective.
- Mention the product where it genuinely helps the reader. Say what it does and where it does not fit. Honest limits build trust.
- Competitor statements need a source URL and a date. If you cannot link it, cut it.
- No invented quotes, studies, statistics, reviews or authors. If you need a number, fetch it and cite it.
- Cut filler: generic intros, "in today's fast-paced world", empty summaries. Cut hype words.
- Match depth to intent. Length is a result, not a target.
- Run a plagiarism and similarity check against the top results before review. Rewrite anything too close.
- Voice: use the brief's voice notes and do-not-say list.

## 6. On-page SEO checklist

- Title under about 60 characters, primary keyword near the start, written for humans.
- Meta description about 150 characters, with a reason to click.
- One H1. Clear H2 and H3 structure. Keywords used naturally, no stuffing.
- Slug short, lowercase, hyphenated, keyword included.
- 3 or more contextual internal links out. 2 or more existing pages updated to link in.
- 1 to 3 external links to credible sources.
- Images: real, compressed, descriptive file names and alt text. Open Graph image set.
- Schema: Article, SoftwareApplication, Organization, BreadcrumbList as fits. FAQ and HowTo rich results are mostly gone, so add them only when they help readers.
- Canonical tag set. Page indexable. In the sitemap.
- Cannibalization check: no other page targets the same primary keyword.
- Performance: the page does not slow the site. Check Core Web Vitals after publishing.
- Tracking: UTM on outbound promotion links, analytics event on the call to action.

## 7. Publishing by pull request

Why: a pull request gives the owner a preview, a diff and a rollback. Merging deploys through the repo's pipeline.

1. Detect the content setup from the repo: framework, content folder, file format (Markdown, MDX), front matter fields, image folder, sitemap generator. Record it in HQ under Plan.
2. Create a branch named `content/<slug>`.
3. Commit the post and images in the repo's own format. Match front matter exactly.
4. Open a pull request with this body:

```
Piece: <title>
Keyword: <primary> | Intent: <intent>
Original element: <what>
Checks: SEO checklist done, facts sourced, links tested, plagiarism check done
Preview: <preview URL if the pipeline makes one>
Distribution kit: <link in HQ>
```

5. Class A: opening the PR. Class B: merging. Ask the owner to merge, or approve a batch merge.
6. After the merge, verify: the URL returns 200, the canonical is right, the page is indexable, the page is in the sitemap, and images load.
7. Log the live URL in the Content calendar.

If the repo has no content setup, propose the smallest one that fits the stack (a `/blog` route with Markdown files) as its own pull request first.

If the owner uses a CMS, publish as a draft through its connector or API. The owner presses publish.

## 8. Indexing

- Keep the sitemap current. Link every new page from at least two existing pages.
- IndexNow notifies participating engines such as Bing. Do not rely on it for Google.
- For Google, use Search Console: submit the sitemap, and request indexing for key pages by hand (the owner may need to do this step).
- Check the Pages report weekly. "Crawled, not indexed" for a new page usually means thin or duplicate content. Improve it. Do not resubmit it unchanged.

## 9. Distribution kit

For each published piece, prepare in HQ:
- One social post per active channel, written natively for that channel.
- One community-native version, only where the rules allow it and the owner approves.
- One newsletter blurb.
- One line for directories and partner pages.
- One short video or carousel script, if the channel is active.

Do not post identical text across channels. Every link carries UTMs.

## 10. Measure and refresh

Check each piece at 2, 4 and 8 weeks. Sources: Search Console, analytics, rank tool.

| Signal | Action |
|---|---|
| Not indexed after 2 weeks | Check technical issues, add internal links, improve the content, request indexing. |
| Impressions but few clicks | Rewrite the title and meta description. |
| Position 8 to 20 | Add depth: missing questions, an original element, more internal links. |
| Page one but no conversions | Fix the call to action and the page's next step. |
| No impressions at 8 weeks | Re-check the keyword and SERP. Merge, retarget or retire the page. |
| Two pages compete for one query | Merge them and redirect the weaker one. |

Refresh evergreen pieces every 3 to 6 months: update data, screenshots and links, and add what changed. Note the update date on the page.

## 11. Volume guardrails

- New site: 1 to 3 pieces a week. Raise only after the first pieces index and earn impressions.
- First 5 pieces: the owner reviews each before merge. After that, batch review is fine if checks pass.
- Never publish a batch of near-identical pages. If a pattern repeats (for example, 30 comparison pages), build 3, review the results, then decide.
- Programmatic pages need unique data per page and the owner's approval of the template.

## 12. Safety

- No fake authors, reviews or testimonials.
- Disclose sponsored or affiliate content where required.
- No scraped or lifted text. Respect licenses on images and data.
- Health, legal and financial topics: stay factual, cite primary sources, add a plain disclaimer, and ask the owner before publishing.
