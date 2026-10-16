# RepoSentinel

**A zero-key repository health report with evidence you can inspect.**

RepoSentinel turns a public GitHub repository URL or a repository ZIP into a prioritized, exportable report. It uses deterministic TypeScript checks: no AI model, AI service, API key, GitHub OAuth, or repository write permission is required.

## Quick start

Use **Node.js 24 LTS** and npm (Node 22.12+ within the 22.x line is also supported).

```sh
npm ci
npm run dev
```

Open the local URL printed by Vite, normally `http://127.0.0.1:5173`. Both ZIP analysis and the public GitHub endpoint work with this command; Netlify CLI and environment variables are unnecessary.

```sh
npm test              # unit, endpoint, and React UI integration tests
npm run typecheck     # strict TypeScript checks, including the function and tests
npm run build         # typecheck + optimized frontend and analysis worker in dist/
npm run preview       # built site + the same local GitHub endpoint, port 4173
npm run test:watch    # interactive development test runner
npm run smoke         # after build: preview + live public GitHub + built worker
```

All direct dependencies are exact-pinned and `package-lock.json` records transitive versions and integrity hashes. Use `npm ci` in CI and deployment.

## Usage

### Public GitHub repository

1. Select **GitHub URL**.
2. Enter a root URL such as `https://github.com/octocat/Hello-World` (a trailing `.git` is accepted).
3. Select **Analyze repository**. The endpoint reads the public default-branch ZIP from GitHub's codeload host, and your browser analyzes its contents in a worker.
4. Review the health score, category scores, and severity/confidence-ordered findings. Filter by category or high priority.
5. Download **Markdown**, **JSON**, or a self-contained, print-friendly **HTML** report. Exports include the complete report regardless of the current UI filter. HTML exports escape repository-provided text and use no scripts or external assets.

Only HTTPS `github.com`/`www.github.com` root repository URLs are accepted. Branch/file URLs, credentials, arbitrary hosts, queries, and fragments are rejected. A private, missing, or empty repository produces a readable error. No login or GitHub token is requested.

### Upload a ZIP

Select **Upload ZIP**, browse for a `.zip` or drop one into the upload area, then select **Analyze ZIP**. Create a source-only ZIP rather than including installed dependencies or build output. A single enclosing directory is removed when it encloses the entire repository; GitHub's Download ZIP layout is supported.

**Uploaded ZIPs stay in the browser.** The application sends no ZIP contents to its server. Files are read in memory, not extracted to disk. Selected repositories are never installed, built, imported, or executed.

### Demo

Select **Try the bundled demo**. The bundled `pocket-tasks` fixture has intentionally incomplete docs, no tests/lockfile, a floating dependency, and a static import cycle. It runs through the actual analyzers without a network request. The physical `environment.example.txt` fixture is presented to the analyzer as `.env.example`; this avoids exposing environment files through Vite's dev server.

The demo does not contain a real credential. It demonstrates actual static findings rather than a precomputed or AI-generated report. A first visit still needs the application assets; the app does not install an offline service worker.

## What is checked

| Category | Deterministic signals |
| --- | --- |
| Documentation | Root README presence/length; setup wording or commands; missing relative Markdown link targets; conventional root license file |
| Tests & CI | Conventional test paths and filenames; Rust inline test markers; non-placeholder npm test scripts; conventional GitHub/GitLab/Azure/Jenkins/CircleCI configuration paths |
| Secret hygiene | GitHub/Slack token signatures, AWS access key IDs, Google API key-like strings, private key headers, credential-bearing HTTP URLs, generic hardcoded credential assignments, non-placeholder `.env` assignments, remote-download-to-shell package scripts |
| Dependencies | Recognized ecosystem manifests; strict `package.json` parsing; npm-style lockfile presence; wildcard/moving/open-ended versions; bare Python requirements |
| Project structure | Root `.gitignore`; recognized source files; explicit skipped-file accounting |
| Architecture | Source modules above 400 non-empty lines; more than 20 static import targets; cycles in resolvable relative JS/TS static imports |

Each finding has a stable rule/instance ID, category, severity (`critical`, `high`, `medium`, `low`, `info`), confidence (0–1), title, explanation, path/line when available, evidence, and a recommendation. Repository-wide absence findings have no invented file/line. Confidence describes the reliability of a **static signal**, not the probability that a vulnerability is exploitable.

Recognized manifests include npm, Python, Rust, Go, Ruby, JVM, PHP, Dart, .NET, Elixir, and Deno conventions. Detailed dependency checks currently cover npm and `requirements*.txt`; presence recognition for another ecosystem is not a dependency audit. Recognized source extensions and ignored directory names are maintained in `src/core/archive.ts` and `src/core/analyze.ts`.

Secret findings redact matched values from their evidence and exports. Source contents are not embedded in reports. Placeholder patterns are suppressed; fixture/example signatures use lower confidence/severity. Confirm findings locally and rotate any genuinely exposed credentials. Detection does not validate credentials or contact their issuing services.

### Health score

Each category starts at 100. Severity penalties are **70 critical / 38 high / 20 medium / 8 low / 0 info**, multiplied by confidence. Repeated instances of one rule cost at most twice that rule's largest single penalty. Category scores are clamped to 0–100 and rounded.

Overall weights: **secret hygiene 30%, documentation 20%, tests 20%, dependencies 15%, structure 10%, architecture 5%**. The weighted score is rounded. Any critical finding caps the overall score at **49**; any high finding caps it at **79**. Findings are prioritized by severity, descending confidence, rule ID, file path, and line. Identical content and a fixed timestamp produce the same report.

This score is a prioritization heuristic, **not a security certification**. A clean report means the configured static checks did not find a signal, not that a repository is safe or well tested.

## Architecture

```text
React UI ── public URL ── POST /api/github ── fixed GitHub codeload origin
   │                           │
   │                        bounded ZIP response
   │                           │
   ├── local ZIP / demo ────────┘
   │
   └── dedicated Web Worker
          ├── ZIP directory/path/size/integrity validation
          ├── bounded text-only decompression
          ├── deterministic rule engine
          └── score + prioritized report ── UI / Markdown / JSON
```

- **React + Vite + TypeScript:** small UI; no routing, database, telemetry, external fonts, or account system.
- **fflate:** raw deflate support. RepoSentinel validates ZIP metadata first, inflates inspected entries in small compressed chunks, counts actual output, and verifies their CRC32.
- **`src/core/`:** portable input validation, snapshots, analyzers, scoring, report types, exports, and shared bounded response reader.
- **`src/analysis.worker.ts` + `src/client.ts`:** keep decompression/rules off the main UI thread; terminating a worker cancels analysis and frees its memory.
- **`src/server/github.ts`:** shared request handler with an injectable fetch boundary for tests. Only the fixed, validated codeload URL is fetched, redirects are refused, responses are bounded, and the fetch/body read has a 15-second deadline.
- **`netlify/functions/github.ts`:** Netlify v2 `Request`/`Response` function adapter. No Netlify SDK dependency is needed.
- **`vite.config.ts`:** attaches the same handler to development and preview servers at `/api/github`.

The application has no persistence. Reports and repository text exist in the current browser session until replaced/reloaded. GitHub archives pass through the function in memory. The app sets no-store response headers and does not add request/body logging. Host-level access logs and GitHub's public download availability are outside the application.

### Limits and input policy

| Boundary | Limit |
| --- | --- |
| Compressed ZIP / GitHub response | 4 MiB |
| Total declared expanded ZIP data | 20 MiB |
| ZIP entries, including directories | 2,000 |
| One inspected text file | 512 KiB |
| Archive path | 240 characters |
| Function JSON request | 2,048 bytes |
| GitHub fetch + response body | 15 seconds |
| Findings retained | 500 highest priority, with a visible truncation note |

The 4 MiB download cap leaves room for binary response overhead on buffered serverless platforms. Files above 512 KiB, unsupported extensions, binary/non-UTF-8 text, and generated/vendor directories are skipped. Their safe paths remain available for presence/link checks and the UI reports how many files were omitted.

Traversal, absolute/drive/backslash/control-character paths, duplicate entries, symlinks, overlapping data, inconsistent headers, encryption, multi-volume archives, ZIP64, and unsupported compression methods are rejected. ZIP file names must be UTF-8 or ASCII; methods 0 (stored) and 8 (deflate) are supported. Checksums and actual expanded sizes are verified for inspected entries; ignored/binary entries are not inflated. Archive contents never reach the filesystem.

## Testing

Tests run locally without network access. Endpoint tests inject synthetic public archive responses instead of relying on GitHub availability.

- `tests/github-url.test.ts`: canonicalization, malicious origins, credentials, ports, encoded paths, root-only policy.
- `tests/archive.test.ts`: wrappers, traversal, malformed headers, compressed/expanded/entry limits, false expansion metadata, checksum corruption, symlinks/encryption/ZIP64/compression rejection, oversized/generated/binary files, direct-input validation.
- `tests/analyze.test.ts`: clean/incomplete fixtures, documentation/link evidence, test detection, manifests/lockfiles, secret redaction, shell pipelines, cycles, large modules, fanout, deterministic ordering, demo, export escaping.
- `tests/export.test.ts`: complete standalone HTML reports, script/markup injection escaping, optional fields, and Markdown/JSON/HTML download contents, filenames, MIME types, and object-URL cleanup.
- `tests/scoring.test.ts`: weights/confidence, severity ceilings, repetition caps, score bounds, priority order.
- `tests/server.test.ts`: endpoint contract, Netlify adapter, fixed outbound target, bounded streaming, timeout/cancellation, safe upstream error mapping.
- `tests/app.test.tsx`: actual demo and ZIP-to-report smoke paths, public-URL-to-report integration, category filters, downloads, invalid input, file drop, loading and cancellation. jsdom substitutes a direct analyzer for browser Worker transport; the actual ZIP parser/rules/scorer run in these tests.

The normal build typechecks the UI, worker, shared core, local middleware, Netlify function, and tests. There is no separate lint configuration. Automated tests do not run an installed real browser or deploy to Netlify.

`npm run smoke` is an optional network-enabled integration check after `npm run build`. It starts production preview on `127.0.0.1:4175`, checks the served site/worker and invalid-URL response, reads `octocat/Hello-World` through the real local endpoint, and sends that ZIP through the actual emitted analysis-worker bundle using a Node worker transport adapter. It closes the server/worker afterward. This check depends on GitHub availability and makes no authenticated requests. `npm test` remains entirely offline.

## Deploy to Netlify

1. Publish this repository to your GitHub account when ready.
2. In Netlify, import the repository as a new site.
3. Keep the repository root as the base directory. `netlify.toml` supplies:
   - Build: `npm run build`
   - Publish: `dist`
   - Node: `24`
   - Functions: `netlify/functions`, bundled with esbuild
4. Deploy. There are **no environment variables or secrets to configure**.
5. On the deployed site, run the bundled demo, upload a small ZIP, and submit a small public GitHub repository URL. Confirm `/api/github` returns a ZIP for a valid POST and a JSON error for invalid input.

The `/api/github` rewrite reaches `/.netlify/functions/github`. Netlify serves the static UI/worker assets and the function. Security headers include a self-only content security policy; inline style attributes are allowed for score indicators. The function requires outbound HTTPS access to `codeload.github.com`.

For manual deployment, deploy **both** `dist` and the function using Netlify's normal repository/CLI workflow. Drag-and-drop of only `dist` does not create the GitHub endpoint; ZIP/demo still work on static hosting. Importing/deploying the repository on Netlify requires your own hosting authorization, but running the app never requests repository write access. No hosting deployment is performed by the implementation scripts.

### Docker

```sh
docker build -t reposentinel .
docker run --rm -p 4173:4173 reposentinel
```

Open `http://localhost:4173`. The multi-stage image builds the site, runs as the unprivileged Node user, and serves production assets with Vite preview plus the shared GitHub middleware. It deliberately retains build tooling for that middleware; Netlify is the primary deployment target. No credentials or repository mount are needed. The Docker build requires npm registry access. The Docker image is not a hardened, high-scale production server.

## CI

`.github/workflows/ci.yml` runs `npm ci`, `npm test`, and `npm run build` on pushes and pull requests with read-only repository permissions. It does not deploy or require secrets. Dependency installation for developing/building RepoSentinel uses npm; repository analysis itself only makes the optional public GitHub read.

## OmniRush usage

This project was implemented in **OmniRush.ai**, with delegated implementation work for the application and standalone HTML exports. The main session reviewed the code and ran the combined checks. OmniRush was the development tool; the deployed application runs deterministic rules, not AI agents. Keep the associated development sessions available for the buildathon judges; this repository does not include private session transcripts or credentials.

Open this folder as the workspace in **OmniRush.ai** and use its terminal/tools to run the documented npm commands. RepoSentinel has no OmniRush runtime dependency and needs no OmniRush/AI API key to function.

Useful project prompts:

- “Run RepoSentinel's tests and production build; explain any failures.”
- “Add a deterministic rule with file/line evidence and a focused regression test.”
- “Review the ZIP limits and endpoint URL allowlist without changing behavior.”

When extending a check, work through `src/core/`, preserve redacted evidence, update the score policy documentation if needed, and verify the demo/upload flows. Run `npm test` and `npm run build` before reviewing a change. Ask explicitly before committing, pushing, or deploying; none of those actions is part of the app.

### Short buildathon demo script

1. Introduce the problem: contributors need actionable repository-health signals without handing a service their credentials or executing unfamiliar code.
2. Open the live site and select **Try the bundled demo**. Show the real test, lockfile, and import-cycle findings, including their file locations and evidence.
3. Analyze a small public repository such as `https://github.com/octocat/Hello-World`. Explain that a fixed-origin serverless download feeds the same browser worker as local ZIPs.
4. Upload a small source-only ZIP. Explain that ZIP contents stay in the browser; show the inspected/skipped counts and the static-analysis limitations.
5. Download the Markdown, JSON, and HTML reports; open the HTML report for a portable, printable handoff.
6. Show `npm test` and `npm run build`, then the public source, CI workflow, Dockerfile, and OmniRush development session. Do not display account settings, credentials, or private files.

## Known limitations

- Static heuristics can produce false positives/negatives. Tests/CI are detected, never executed; a present test file does not prove coverage or correctness.
- No CVE/advisory lookup, dependency installation, full syntax/type analysis, Git history analysis, credential validation, or AI inference. Common secret patterns are supported, not every credential format or encoding.
- Import-cycle analysis covers recognized static relative JS/TS imports, including type-only imports. Aliases, dynamic imports, package boundaries, and other languages are not fully resolved; type-only cycles and barrels can be harmless.
- Documentation link parsing is intentionally basic Markdown, without generated routes, reference-style links, anchor validation, or remote HTTP checks. Setup wording is English-oriented.
- Skipped, oversized, binary, generated, non-UTF-8, or unsupported files reduce coverage. Presence and absence are interpreted using available safe archive paths and visible notes. An all-unsupported archive is rejected.
- Large/ZIP64/encrypted/nonstandard archives are rejected. A single enclosing folder is treated as a repository wrapper; very minimal archives with only one top-level directory can therefore have paths shortened.
- GitHub input reads only the public default branch. Availability, rate limits, empty repositories, and the 4 MiB cap can prevent remote analysis; a smaller source-only ZIP is the local fallback. Git LFS pointers/submodule links are not expanded.
- No server-side history, accounts, sharing links, scheduled monitoring, or automatic repository changes. Reports are downloaded explicitly by the person using the app.
- The public function is resource-bounded but has no distributed per-user rate limiter. Use the hosting platform's traffic controls if publishing to a high-traffic audience.

## License

MIT — see [LICENSE](LICENSE).
