# Privacy

Kailashe is local-first: state lives in `.kailashe/` in your project, `prompt.md` at your project root. There is no telemetry, no analytics, and no crash reporting. This page lists exactly what leaves your machine (SPEC §7) and must stay accurate.

| Destination | What leaves the machine | Authorized by |
|---|---|---|
| Meta Model API (or the OpenAI-compatible base URL you configure) | Redacted command output, fetched docs excerpts (quote-blocked as untrusted data), repo digest/profile | `MODEL_API_KEY` in `.env`; contributor tier only per the gate below |
| Provider clouds (via their own CLIs) | App artifact/image, config, resource creates per the plan you approved | Your own CLI login — Kailashe never sees or stores provider credentials |
| Market data APIs (DataForSEO, SerpApi; later Semrush/Ahrefs/Trends) | Seed terms, keywords, URLs queried | Your keys in `.env`; **no paid calls while `KAILASHE_MARKET_BUDGET_USD` is unset** |
| Fetched doc/web pages (`fetch_docs`, screenshots) | Outbound GET only; provider-docs domains allowlisted in `providers/*.yaml` | Provider registry |
| Clipboard + Muse URL | `prompt.md` content, only when you press Execute at the gate | You pressing Execute |
| Cloudflare Registrar API (only when asked) | Domain search/registration; price confirmed by typing it | Your request + typed price confirmation |
| Nowhere else | — | No telemetry, ever |

## Model tiers (Meta)

Kailashe defaults to the standard model `muse-spark-1.3`. Contributor-tier models (`muse-spark-1.3-contributor`) are refused unless `KAILASHE_ALLOW_CONTRIBUTOR_TIER=1`, and every such run prints a warning.

We do not paraphrase Meta's retention or training terms. For the standard/contributor distinction, read Meta's own pages:

- Pricing, rate limits, and tier terms: https://dev.meta.ai/docs/pricing-rate-limits
- Contributor tier policy: https://dev.meta.ai/help/policies-and-privacy/contributor-tier
- Quickstart (endpoint and key handling): https://dev.meta.ai/docs/quickstart

Because the base URL and model are configurable (`KAILASHE_LLM_BASE_URL`, `KAILASHE_MODEL`), you can point Kailashe at any OpenAI-compatible endpoint, including a local open-weights model, in which case no prompt data leaves your machine via the LLM path.
