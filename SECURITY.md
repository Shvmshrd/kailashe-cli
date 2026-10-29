# Security

## Threat model (summary of SPEC §5)

**Trusted-but-hardened provider CLIs.** Kailashe assumes the official provider CLIs (aws, doctl, vercel, wrangler, fly) you installed are trusted (Q9), but hardens how they are invoked: sanitized `PATH`, absolute path resolution, refusal to run binaries inside the project directory or `node_modules`, and path+version recorded in the audit log.

**Allowlisted runner.** Every subprocess goes through the core runner (`packages/core/src/runner`): `execa` with an args array — never `shell: true`. Commands are matched against the per-provider allowlist (binary + subcommand patterns) loaded from `providers/*.yaml` before spawn; non-matching commands are refused. Risk classes `read|create|modify|delete|iam-billing-network` gate approval prompts.

**Redaction everywhere.** Secrets are redacted on every output path: logs, state, `prompt.md`, audit log, and anything sent to the model. `.kailashe/audit.jsonl` is append-only and redacted. Kailashe never reads provider credential files and never writes secrets to logs, state, or fixtures.

**Untrusted text.** Third-party text (web pages, docs, SERPs, competitor sites) is data, not instructions. It enters prompts only inside delimited, labeled, length-capped quote blocks. A repo file saying "ignore previous instructions" changes nothing (covered by a fixture test).

**Approvals.** Anything paid, destructive, public, or hard to undo requires approval (exit 3 when denied). Deploy plans show resources, exact commands, monthly cost, and rollback before any create/modify/delete.

## Reporting a vulnerability

Open a private security advisory on the GitHub repository, or email the maintainers listed there. Please do not open public issues for vulnerabilities. Include reproduction steps and the Kailashe version (`kailashe --version`).
