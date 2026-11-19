# bb-plugin-voice-reactions

<!-- devkit:agents v1 -->
<!-- managed by devkit v1: edit in https://github.com/neoromantic/devkit/blob/main/agents/AGENTS.shared.md -->

## Shared rules (devkit)

These rules apply to people and coding agents in every repo that uses
[devkit](https://github.com/neoromantic/devkit). Project rules follow in `## Project` below.
Where they conflict, the project section wins.

### Data

- Use only made-up data in tests, fixtures, examples, docs and screenshots. No real people, chats,
  phone numbers, tokens, session files or local paths such as home directories.
- Never commit `.env` files with values, or credentials; `.env.example` and password-manager
  reference files are fine. Tests run offline by default; live API tests are opt-in and read
  their credentials from the environment.

### Commands

Use the project section's native commands for checks, offline tests and builds:

- Bun: `bun run <script>` (`check`, or `lint` and `typecheck`; `test`, `test:e2e`, `build`).
  `bun run format` formats; `check` fails on unformatted code and on lint errors.
- Python: the documented `uv run` / `uvx` commands, such as pytest, unittest and ruff.
- Go: the documented `go` commands from `go.mod`. Do not add Bun wrappers for Python or Go.
- Use Bun, uv or Go modules for installs. Use npm only for `npm publish` and `npm view`.

### Code

- Make the smallest change that works, then make it smaller. No drive-by refactors.
- Validate input at the boundaries (CLI arguments, HTTP, files, environment) and trust it
  inside: no fallbacks or checks for states that can't happen, no compatibility code for
  callers that don't exist. Published interfaces change only as the release procedure allows.
- No helpers or abstractions for logic with a single caller. More in the
  [code patterns standard](https://github.com/neoromantic/devkit/blob/main/docs/standards/code-patterns.md).

### Definition of done

- The change works end to end and the project's applicable checks and tests pass locally.
  Verify with targeted checks and builds for what changed; wait for a full CI run only when the
  task needs its result. Required checks still gate the merge.
- README, docs and affected demos change with the behaviour they describe; follow the
  [product content standard](https://github.com/neoromantic/devkit/blob/main/docs/standards/product-content.md).
- No new warnings, no commented-out code, no stray debug output.
- JS and TS follow the [lint and format standard](https://github.com/neoromantic/devkit/blob/main/docs/standards/lint-format.md):
  no prose comments (rationale goes in the PR), tests beside their code, no mocks of the code
  under test, no fixed sleeps or retries. Fix the code; exceptions go in `.oxlintrc.json`.
- A test names the behaviour it protects and fails on a believable bug. Strengthen the test that
  owns a contract instead of adding another; delete tests that repeat one or restate the code.
  Tests run in parallel workers, each with its own temp dir, port, database and environment
  ([testing standard](https://github.com/neoromantic/devkit/blob/main/docs/standards/testing.md)).
- A pull request's CI runs one runtime version and only the jobs its diff can affect; other
  versions and platforms run after merge, on a schedule or on request
  ([CI speed standard](https://github.com/neoromantic/devkit/blob/main/docs/standards/ci-speed.md)).

### Commits and releases

- Conventional Commits: `feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`, `ci:`.
  A breaking change adds `!` (`feat!:`) and a `BREAKING CHANGE:` footer. In a monorepo the
  scope names the workspace (`feat(web):`). With squash merges the pull request title is the
  commit title and follows the same format.
- One logical change per commit. Never rewrite published history or force-push `main`.
- Follow the project's documented release procedure, including any owner-only steps. It defines
  versioning, tags, changelog and delivery (release, skill revision or production deployment).

### Files

- Don't add planning or progress files (`progress.md`, `docs/plans/`). Plans live in issues.
  `ROADMAP.md`, if present, is a short "Known gaps" list that links issues.
- Don't add agent hooks that rewrite tracked files.
- `AGENTS.md` is the canonical instruction file. `CLAUDE.md` contains only `@AGENTS.md`.
- Files marked "managed by devkit" (this block, `SECURITY.md`, `CONTRIBUTING.md`, the PR
  template, `.gitleaks.toml`, `.github/zizmor.yml`, `renovate.json`, `lefthook.yml`, the
  CI stub, `.oxfmtrc.jsonc`, the `.oxlintrc.devkit*.jsonc` configs and the usage telemetry
  clients) are synced from devkit. Change them there, not here.

<!-- /devkit:agents -->

## Project

A server-side BB plugin (TypeScript, Bun for tooling). BB loads `server.ts` through the built
`dist/server.js`; `dist/` is committed because BB's Git installs need the built artifact, and
BB runs it on Node, so plugin code uses Node APIs only.

- Install: `bun install --frozen-lockfile`
- Format: `bun run format` (oxfmt). Lint: `bun run lint` (oxlint with the landmines rules).
- Check: `bun run check` (`format:check` and `lint`, then TypeScript, then `check:knip`).
- Test: `bun run test` (offline, parallel). Tests sit beside their code in `src/`; the shared
  harness, fixtures and the player stand-in are in `test/`. Local servers replace every
  provider, so a test never needs a key, the network or a sound device.
- Build: `bun run bundle` (the official `bb-app` CLI). Commit `dist/` with every source change;
  CI does not run BB.
- `bun run bench:voice` is the one live tool: it calls the real voice services with keys from
  the environment, costs money and writes WAV files without playing them. It is never part of
  `check` or `test`; see "Comparing voices and models" in `docs/roles.md`.
- Never run a real audio player in tests or checks: the `player` setting points at
  `test/player-stub.ts`.
- Logs must not contain message text, response bodies, keys or the text of foreign errors; see
  "Keys and data" in `docs/how-it-works.md`.
- `docs/how-it-works.md` holds the reasons behind the message filter, the providers and the
  voice session. Change it with the behaviour it describes.
