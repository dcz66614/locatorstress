# P022 LocatorStress — ENVIRONMENT_REPORT.md (T001)

Environment measured on the build VM. All versions below are exact values
observed by running the commands listed, not values copied from the spec.
The spec does not claim Windows; this VM is Linux (Ubuntu 24.04.5 LTS),
recorded as-is per PROJECT_BOOK §9.

## Host

| Item | Value |
|---|---|
| OS | Ubuntu 24.04.5 LTS (`PRETTY_NAME="Ubuntu 24.04.5 LTS"`, `VERSION_ID="24.04"`) |
| Kernel | Linux 7.0.0-44-generic x86_64 |
| CPU | AMD EPYC 9D25 126-Core Processor, 4 vCPUs visible (`nproc` = 4) |
| Memory | 7934 MiB total (`MemTotal: 8124900 kB`); ~1045 MiB available at report time |
| Platform / arch | linux / x64 |

## Runtime and toolchain

| Item | Value |
|---|---|
| Node.js | v24.22.1 |
| npm | 10.9.4 |
| TypeScript | 5.9.3 (devDependency, exact pin in `package.json` / `package-lock.json`) |
| Vitest | 5.1.0 (devDependency, exact pin; no tests in T001) |
| Playwright | 1.65.0 (dependency, exact pin) |

## Browser

| Item | Value |
|---|---|
| Playwright-expected Chromium revision | 1254 (`playwright-core/browsers.json`: revision 1254, browserVersion 158.0.8127.18) |
| Chromium used by the baseline run | Google Chrome for Testing 158.0.8127.18 (`browser.version()`) |
| Executable used | `~/.cache/ms-playwright/chromium-1254/chrome-linux64/chrome` (pre-cached; nothing downloaded at runtime) |
| Headless shell (cached, not used by T001) | `chromium_headless_shell-1254` present |
| Older cached build (not used) | `chromium-1248` — Google Chrome for Testing 156.0.8078.4 |
| Launch flags | headless, `--no-sandbox`, `--disable-dev-shm-usage`; viewport 1280×800 |

Chromium selection rule: the runner uses **only** chromium-1254
(`~/.cache/ms-playwright/chromium-1254/chrome-linux64/chrome`). There is no
fallback to another revision — if chromium-1254 is missing, the run fails
(non-zero exit). After launch, `browser.version()` is asserted to equal
`158.0.8127.18`; any other version also fails the run.

## How versions were verified

- `node --version`, `npm --version`, `nproc`, `free -m`, `uname -r`,
  `/etc/os-release`, `lscpu` — host facts above.
- `npm view playwright/typescript/vitest version` — registry check before pinning.
- Playwright 1.65.0's `browsers.json` — expected chromium revision 1254.
- `~/.cache/ms-playwright/chromium-1254/chrome-linux64/chrome --version` —
  `Google Chrome for Testing 158.0.8127.18`.
- `npm run s0:locator-oracle` — live run reports `playwright: 1.65.0`,
  `chromium: 158.0.8127.18`, `node: v24.22.1` in
  `evidence/environment/T001_BASELINE.json`.

## Baseline result (T001)

- Baseline locator `button.primary` (kind `css`): rawMatchCount 1,
  finalMatchCount 1, executionStatus `COMPLETED`, identityMatch `true`.
- Identity probe: node (DOM-object) identity `true`, Node-side wrapper
  `===` `false` — Playwright mints a fresh JS wrapper per
  `elementHandle()` call, so true identity is tested in-page with
  `page.evaluate(([a, b]) => a === b, [actual, original])`.
- Second run in the same session （同一会话内重复运行）: repeat run in the
  same session (same browser / same context / same page, `setContent`
  re-run — not an independent session) with identical result (reproducible).
- Interception verified by a negative probe: 2 external attempts (an
  `<img src="https://example.invalid/x.png">` load and a
  `fetch("https://example.invalid/")`), both blocked; the run reports
  `externalRequests=2`, `blockedRequests=2`. The check asserts these
  counters (a positive intercept verification), not that "no external
  requests occurred".
- Frame identity probe (inline iframe `srcdoc`): sameTarget `true`
  (frame-scoped original capture matches the resolver's frame-scoped
  result), decoy `false` (a sibling `button.decoy` in the same iframe is
  not the same DOM node).
- Chromium selection: chromium-1254 only, no fallback to any other
  revision; `browser.version()` asserted to be `158.0.8127.18`.
- Private oracle target path: structural positional path
  `main > button:nth-child(2)` (position/hierarchy only) — no
  `data-testid` anchor is used in the baseline HTML.
- Full evidence: `evidence/environment/T001_BASELINE.json`,
  `evidence/environment/T001_BASELINE.log`.

## Notes and deviations

- The VM is Linux, not Windows. PROJECT_BOOK §9 requires recording the
  actual OS and adapting, not claiming Windows was tested. No Windows
  testing is claimed here.
- No browser was downloaded: the run used the pre-cached chromium-1254
  binary via `executablePath`, which matches the revision Playwright
  1.65.0 expects, so no `npx playwright install` step was needed.
- No LICENSE file was created (license `PENDING_SAM_DECISION`).
