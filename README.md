# Kailashe

Open source (MIT) CLI, stdio MCP server, and skill pack that takes an AI-built project from "runs locally" to "live URL" — and then operates it as a side business: market research, an archetype plan, a backlog, a tool manifest, and a composed `prompt.md` for Muse.

Kailashe never handles provider credentials. Deploys run through each provider's own CLI (AWS, DigitalOcean, Vercel, Cloudflare Pages, Cloudflare Workers, Fly, Modal) on your own logged-in account, behind an allowlisted, redacting, audit-logged runner. See [SECURITY.md](SECURITY.md) and [PRIVACY.md](PRIVACY.md).

Spec: [docs/SPEC.md](docs/SPEC.md) · Tasks: [TASKS.md](TASKS.md) · Skill pack: [skill/kailashe-operator](skill/kailashe-operator)

## Quickstart — five commands

```sh
npx kailashe init          # install the operator skill pack (.agents/skills + .claude/skills)
npx kailashe doctor        # check node, provider CLIs, env
npx kailashe validate-pack # validate the skill pack (also runs in CI)
# copy .env.example to .env and set MODEL_API_KEY
npx kailashe deploy        # detect → choose provider → approve plan → deploy → verify
npx kailashe operate       # scan → market → plan → prompt.md gate (Execute / Edit / Quit)
```

`deploy` always asks which provider to use (it preselects one with a reason; AWS is never preselected), shows an exact plan — resources, commands, monthly cost, rollback — and runs nothing create/modify/delete until you approve.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | ok |
| 1 | unexpected error |
| 2 | usage error (bad flags/args) |
| 3 | needs input, or approval denied |
| 4 | provider auth failed |
| 5 | deploy failed or partial |
| 6 | validation failed |
| 7 | budget exceeded |
| 130 | interrupted (SIGINT) |

## Configuration

Copy `.env.example` to `.env`. Key settings: `MODEL_API_KEY`, `KAILASHE_MODEL` (default `muse-spark-1.3`), `KAILASHE_LLM_BASE_URL` (default `https://api.meta.ai/v1`; any OpenAI-compatible endpoint works), `KAILASHE_MODEL_BUDGET_USD` (default 3 per run), `KAILASHE_MARKET_BUDGET_USD` (no paid market calls while unset). Contributor-tier models (`*-contributor`) are refused unless `KAILASHE_ALLOW_CONTRIBUTOR_TIER=1` — see [PRIVACY.md](PRIVACY.md).

## MCP server

`packages/mcp` exposes a stdio MCP server: read tools `detect_project`, `list_providers`, `status`; write tools `deploy`, `scan_business`, `build_prompt` require explicit confirmation.

## Development

```sh
pnpm install && pnpm build && pnpm typecheck && pnpm lint && pnpm test
```

`pnpm test:e2e` needs `KAILASHE_E2E=1` and real accounts; never run in CI. Contributing: [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT
