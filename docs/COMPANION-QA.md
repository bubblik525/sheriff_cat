# Companion v0.3 verification

- 25 Node tests passed, including original terminal/research regression tests.
- Browser checks: feed updates fish/mood/XP; tier preview updates access; compare opens selected tokens; dossier opens evidence; watch action persists; size estimate opens; virtual entry and close work; condition creation persists; no captured browser errors.
- Responsive layouts inspected at 1440px and 390px; no horizontal page overflow at 390px.
- All interface text is English. Offline demo is clearly labeled. Actual token contract and thresholds are intentionally unset.
- Cloud Worker bundles successfully with Wrangler 4.92.0 dry-run.
- Cloud handler/schema checks run against Node SQLite through a D1-shaped adapter, including duplicate/concurrent claims and independent credentials.
- Full local Miniflare D1 binding test stalled; that runtime integration is not certified. Test processes were terminated. Cloud service is not deployed.
- No current personal provider credential was used. Live API availability and actual holder access remain to be checked after configuration.
- Native signed installers are not included. The standalone Node app opens a private graphical interface in the local browser.

### Pro Terminal / Session Guardian

- 28 Node tests pass, including visible-time counting, duplicate heartbeat handling, absence gaps, persistence across serialization, cooldown expiry, paper equity vs cash, stale quotes and backend restrictions.
- Browser: position planner returns $10 risk / $100 size for $1,000, 1% risk, 10% stop. Saving limits and starting a real one-minute manual break displays the rest banner.
- Desktop 1440 layout visually inspected; narrow viewport has no document horizontal overflow. New trading remains blocked on the backend; paper exits remain allowed.
- No live provider or real-wallet profit verification is claimed by these demo checks.

### Desktop 0.4

- Electron desktop window launched on macOS arm64; backend authenticated state returned successfully and the window capture showed the rendered companion.
- Dedicated backend test validates an assigned free port, unauthenticated rejection, foreign-origin rejection, session rotation and clean profile reopening.
- Native launch is asynchronous relative to Electron readiness to avoid an ESM startup deadlock.
- Windows/Linux installers are configured in GitHub Actions, not locally verified. macOS preview is unsigned and not notarized.

### Dynamic observation engine

- 32 tests passed: activity filters handle stale/unknown data, duplicate observations do not create duplicate events, histories remain bounded, and demo token generation stays unique and capped.
- Browser verified changing prices, new CAT-series demo tokens, sub-second displayed quote age and the WATCH candidate board.
- Live upstream throughput has not been verified with a personal API key. One second is a scheduling target, not a guaranteed fresh quote or guaranteed new launch each second. Launch scanning retains 12 confirmations.
