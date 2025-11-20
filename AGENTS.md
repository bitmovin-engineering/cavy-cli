# Repository Guidelines

## Project Structure & Module Organization
- `cavy.js` is the CLI entrypoint exposing `init`, `run-ios`, `run-android`, `run-web`, and `run-vega`.
- `src/` holds command logic: `init.js` scaffolds specs, `runTests.js` swaps entry files and drives builds, `junitFormatter.js` emits JUnit XML, `screenshot.js` captures artifacts.
- `server.js` hosts the WebSocket report server on port 8082 and writes `cavy_results.md/xml`.
- `templates/` ships the generated test entry (`index.test.js`) and sample spec (`exampleSpec.js`) used by `cavy init`.
- Keep docs (`README.md`, `CHANGELOG.md`, `LICENSE`) aligned with CLI flag/behaviour changes.

## Build, Test, and Development Commands
- `npm install` to fetch deps; run inside repo before linking.
- `node cavy.js --help` for flag reference.
- `npm link` here to test the CLI globally against a React Native app.
- Scaffold tests in an RN app root: `cavy init specs` (creates `specs/` + `index.test.js` when absent).
- Run suites: `cavy run-android --file index.js --boot-timeout 3 --xml`, `cavy run-ios --dev`, or `cavy run-web --buildCmd "npm run web"`.
- Android runs `adb reverse tcp:8082 tcp:8082`; ensure `ANDROID_HOME` or `adb` exists.

## Coding Style & Naming Conventions
- JavaScript (Node) with 2-space indentation, single quotes, trailing semicolons; prefer `const`/`let`.
- Keep CLI logs brief, human-friendly, and often prefixed with `cavy:`.
- Avoid new dependencies unless necessary; audit `package.json` first.
- Entry files should end in `.js` with matching `.test.js`; default is `index.js`/`index.test.js`.

## Testing Guidelines
- No local unit suite; validate by linking (`npm link`) and running against an RN app.
- Default specs live in `specs/`; override with `cavy init <folder>`.
- `--xml` writes `cavy_results.xml` (Cavy ≥3.3.0); markdown summary always lands in `cavy_results.md`.
- Preserve the entry-file swap/teardown in `runTests.js`; confirm cleanup on failure or SIGINT.
- Port 8082 must be free; avoid parallel runs on the same machine.

## Commit & Pull Request Guidelines
- Follow history: short imperative subjects (e.g., “Add support for Web and Vega tests”); release bumps use bare semver.
- Keep release/dependency bumps isolated from feature work.
- PRs should note platforms touched, CLI flags affected, repro steps, and test/log snippets; link issues when present.
- Keep generated artifacts out of commits and open PRs as drafts until validated.

## Security & Configuration Tips
- Ignore generated results (`cavy_results.*`) and screenshots in commits.
- Use Cavy versions that support the flags you rely on (`--xml`, `--boot-timeout`).
- If changing port/behaviour in `server.js`, update `README.md` and downstream guides to avoid breaking pipelines.
