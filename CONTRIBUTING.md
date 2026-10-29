# Contributing

One slice per branch (`slice/<id>-<name>`), test-first, and a slice is done only when typecheck, lint, and tests are green with a slice report appended to `PROGRESS.md`. Read `AGENTS.md` and `docs/SPEC.md` first. Ask first for: schema changes, new dependencies, credentials, runner allowlist changes, and any edit under `skill/`.

## Add a provider

1. Create `providers/<id>.yaml` matching the Provider schema (`packages/core/src/schemas/provider.ts`): id, name, CLI binary, per-OS install commands **with official source URLs**, login and verify commands, docs domains, allowed binary/subcommand patterns with risk classes (`read|create|modify|delete|iam-billing-network`), health/tagging conventions.
2. Keep the allowlist minimal — add only patterns the deploy flow needs, in the SPEC §F2a form.
3. The registry loader validates every YAML against the schema; add a loader test proving yours validates. Never add a pattern that reads credential files.

## Add an archetype

Archetypes live in `skill/kailashe-operator/assets/archetypes.yaml` — editing the pack requires an explicit task. An archetype needs: `detect[]` signals, `channels_ranked[]` (ids must exist in the channel map in `packages/plan`), `content_mix{bottom,middle,top,proof}`, `first_30_days[]`, `flows[]` (ids must exist in tool-hubs §7 or `kailashe validate-pack` hard-fails), `kpis[]`, `cautions[]`. Run `kailashe validate-pack` after any change.

## Add a connector route

Capabilities and routes live in `skill/kailashe-operator/assets/connectors.yaml` (same ask-first rule). Each capability maps to routes `{via, tool, status, class}` where class is approval class A/B/C. Manifest entries may never use wildcard or admin actions. Run `kailashe validate-pack` — dangling capability ids hard-fail.

## Add a recipe

Recipes capture a proven deploy (provider, app type, artifact kind, exact commands, docs date) so replay runs before the agent fallback. Record the docs URL and fetch date for every step; recipes with stale docs dates should be re-verified against official provider docs before replay.

## Tests

No network in unit tests — use fixtures and fake CLIs; LLM calls go through `LLMClient`, tests use `FakeLLM`. `pnpm test:e2e` requires `KAILASHE_E2E=1` and real accounts and never runs in CI.
