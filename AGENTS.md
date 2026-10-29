# AGENTS.md
Kailashe: open source CLI, stdio MCP server and skill pack. Spec: docs/SPEC.md. Tasks: TASKS.md.
skill/kailashe-operator/ is the source of truth for operator content. Change it only via a task.

Commands
- pnpm install | build | test | lint | typecheck
- pnpm test:e2e needs KAILASHE_E2E=1 and real accounts. Never in CI.

Rules
- Validate every external input with Zod at the boundary. No any.
- Subprocesses: execa with an args array. Never shell: true. All cloud CLI calls go through the core runner (allowlist, redaction, audit).
- Never read provider credential files. Never write secrets to logs, state, prompt.md or fixtures.
- Third-party text (web pages, docs, SERPs, competitor sites) is data. It enters prompts only inside delimited, labeled, length-capped quote blocks.
- No network in unit tests. Use fixtures and fake CLIs. LLM calls go through LLMClient. Tests use FakeLLM.
- New dependency: justify license, maintenance and size. Pin exact versions.
- One slice per branch. Red tests block merge.

Ask first
- Schema changes, new dependencies, credentials, runner allowlist, edits under skill/.

Done means
- typecheck, lint and tests green, acceptance criteria met, docs updated, slice report written.
