# Channel playbooks

Contents: 1 Rules for every channel, 2 Directories and listings, 3 Communities, 4 Hacker News, 5 Social, 6 Email, 7 Outreach and PR, 8 Reviews and proof, 9 Launch, 10 Paid, 11 Growth loops, 12 Support loop

## 1. Rules for every channel

- Pick channels from the Market page ranking. Do not spread thin. Run 3 to 4 channels well.
- Give before you ask. Be useful in a place before you promote in it.
- Read the rules of every platform and community before posting. Record the rule summary in HQ. Unsure means ask.
- Every post is written for that place. No copy-paste across channels.
- Disclose that the owner built the product when posting about it.
- Every link carries UTMs (`ops-loop.md` section 8).
- Pace posts. Space them out. Never burst.
- You prepare, the owner approves, you execute and verify. Class C for the first post in any community.
- Official APIs and connectors come first. The browser is the fallback. Platform API access has its own terms and fees. Check them before building on a route.
- Log every action with its evidence link.

## 2. Directories and listings

When: week 1 to 3, almost every archetype. Goal: referring domains, discovery, and early traffic.

Setup, the listing kit (build it once, in HQ):
- Name, one-line tagline (3 versions), descriptions at about 160, 300 and 500 characters.
- Category and tag choices, pricing summary, links (site, docs, repo), founder bio.
- Logo (square and wide), 3 to 5 screenshots, a short demo video link, social handles.
- A support email that works.

Do:
1. Take the directory list the CLI attached (name, URL, category, free or paid, notes). Remove link farms, dead sites, and anything that sells links or fake reviews.
2. Order by relevance and quality. Quality beats count.
3. Submit in batches of 5. Use the connector or API if one exists, else the browser. Use the support email for verification mails and click them through the email connector.
4. Fill the Directory tracker: directory, URL, submitted date, status, listing URL, notes.
5. Re-check pending ones weekly. Follow up once on stale ones.

Approval: class B per batch. Class C for anything paid.
KPI: live listings, referring domains, referral visits.
Pitfalls: paid listings without approval, mismatched categories, inconsistent descriptions, submitting the same text everywhere (vary the long description).

## 3. Communities

When: from week 2. Where: subreddits, forums, Discords, Slack groups, Q&A sites, Indie communities, GitHub discussions.

Do:
1. For each target community, read the rules and the last 30 days of top posts. Write the rule summary and "what works here" in HQ.
2. Participation first. Prepare 3 to 5 genuinely helpful replies a week for the owner to post or approve. No links unless the rules allow them and the link answers the question.
3. After the owner has real participation history, prepare one launch or story post per community. Format fits the place: a story, a lesson, a free resource, an honest "I built this" with the owner's disclosure.
4. Reply to every comment with substance. Log feedback in the backlog.

Rules:
- One post per community per product event. No cross-posting identical text.
- No unsolicited DMs.
- No vote or upvote requests. No sock puppets.
- If a community bans self-promotion, do not post. Use participation only.

Approval: class C for each post. You draft, the owner posts or approves the exact text.
KPI: useful replies, referral visits, saved leads, feedback items.
Pitfalls: sounding like an ad, ignoring the rules, posting and vanishing.

## 4. Hacker News

- The official API is read-only. Posting happens only on the website. Use the browser route only with the owner's login and approval, or ask the owner to post.
- Prepare a Show HN draft: a plain title, a short first comment from the owner explaining what it is, why they built it, what is rough, and how to try it without signing up if possible.
- No marketing tone. No asking for votes. No sharing the link to gather upvotes.
- The owner should be around for the first few hours to answer comments. Schedule around that.

Approval: class C.

## 5. Social

When: from week 2, on the 1 or 2 networks where the audience is (Market page).

Do:
1. Define 3 content pillars (for example: build in public, how-to tips, demos and results, opinions from the owner's experience). Write them in HQ.
2. Plan a calendar: 3 to 5 posts a week per network. Prepare a week at a time.
3. Mix formats: short text, threads, screenshots, short video or carousel, polls.
4. Repurpose each content piece (`content-engine.md` section 9) into native posts.
5. Engage: reply to relevant conversations with value. Prepare replies for the owner. No mass auto-replies. No automated DMs.
6. Use the native connector or a scheduler through a hub. Scheduled posts from an approved calendar are class B.

Routes: see `assets/connectors.yaml` (Meta apps have built-in connectors, others go through custom connectors, hubs or the browser).
KPI: profile visits, link clicks, replies, follows from the target audience.
Pitfalls: posting only promotion, posting daily filler, buying followers.

## 6. Email

When: from week 1 (capture), week 3 onward (sequences).

Do:
1. Capture. Add a signup form with a clear promise, consent text, and a working unsubscribe. Use double opt-in where the law or the tool requires it.
2. Welcome sequence, 5 emails over 14 days: welcome and one quick win, the core use case, a story or proof, a common mistake or tip, an invitation to reply or upgrade. Plain text style. One call to action each.
3. Product updates and a newsletter, monthly or weekly, to the opted-in list.
4. Transactional emails (receipts, resets) stay separate from marketing.
5. Track opens as a weak signal. Track clicks and replies as strong signals.

Rules:
- Only email people who opted in or who are existing customers with a clear relationship. Follow the laws that apply (consent, identification, unsubscribe).
- Every marketing email has a visible unsubscribe and the sender's identity.
- Never import purchased lists.

Approval: the first send of each template is class C. Later sends from the approved template to the same list are class B.
Routes: Klaviyo or another email platform through its connector or a hub. Gmail or Outlook for one-to-one messages.

## 7. Outreach and PR

When: from week 4, after the site and content are solid.

Targets: newsletters, bloggers, podcasts, YouTubers, journalists, directories of tools, "best of" roundup authors, integration partners, communities' moderators (for permission, not promotion).

Do:
1. Build a target list from search: name, audience, why relevant, contact route, one personal detail that is public and professional.
2. Write short, specific emails: who the owner is, why this person's audience cares, one clear offer (an exclusive, a resource, an offer to be a source), and one easy next step.
3. Batch of 10 to 20 at a time. One polite follow-up after 5 to 7 days. Stop after that.
4. Log everything in the Outreach CRM.

Rules:
- No bulk generic blasts. No tracking pixels if the owner does not want them. Honor opt-outs at once.
- Never buy links or offer payment for coverage without the owner's approval. Mark sponsored items clearly.

Approval: class C for the first message to each new recipient. Show the exact email per recipient or a sample plus the full list for a small batch.
KPI: replies, mentions, referring domains, referral visits.

## 8. Reviews and proof

- Ask real users for feedback and reviews at a good moment (after a win). Use the `review-request` flow if it is built.
- Make it easy: a direct link. Never offer payment for positive reviews. Never write reviews for the owner.
- Reply to every public review, good or bad, within two days. Prepare drafts. The owner approves.
- Turn real wins into case studies with the customer's permission.
- Keep a proof library in HQ: quotes (with permission), numbers, screenshots, logos (with permission).

## 9. Launch

Use for a major release or the first public launch. Timeline in days from launch day (T):

- T minus 14: choose the platform (Product Hunt, Show HN, a community, a newsletter). Build the kit: tagline, description, gallery, first comment, demo link, FAQ, owner story.
- T minus 10: line up supporters who truly use the product. Ask for honest feedback and an honest comment, not votes. Pre-brief newsletters.
- T minus 7: dry run: signup flow, pricing page, analytics, server capacity (check the deploy), support inbox.
- T minus 3: schedule posts. Prepare replies to likely questions. Confirm the owner's availability.
- T: post, answer every comment for the first hours, share updates across channels (natively), log feedback.
- T plus 1 to 7: thank people, send a follow-up email to signups, publish a "what we learned" post, fix the top 3 issues, update the backlog.

Approval: class C for each public post.

## 10. Paid

Off by default. Turn on only if the owner sets a monthly budget and a daily cap in HQ.

Rules:
- Start small, one channel, one offer. Test creative in batches of 3.
- Daily cap and a kill switch in the plan. Pause at the cap.
- Never raise budgets yourself. Recommend, then ask.
- Report cost per outcome weekly. Stop what does not pay back after the agreed test period.

Approval: class C for any spend or budget change.

## 11. Growth loops

Look for loops built into the product. Propose, do not build without approval:
- Shareable output: a public result page, a report, a badge (opt-in "built with" link).
- Templates and free tools that rank and lead into the product.
- Integrations: listings in the Zapier, Composio, Activepieces or n8n catalogs and in partner marketplaces, if the product has an API.
- Open source: a strong README, docs, examples, an "awesome" list inclusion, a clear contribution guide, issue labels for newcomers.
- Referral: simple, honest, with a reward that costs little.

## 12. Support loop

- Triage support email, chat and issues daily. Label: bug, question, feature request, praise.
- Draft replies from the brief and docs. The owner approves sends at first. After 20 approved replies of one type, ask to move that type to class B.
- Add recurring questions to the docs and FAQ.
- Feed features and complaints into the backlog with counts. Report the top 3 each week.
