// playwright.config.mjs — dev/verify loop only, never shipped in a game.
import { defineConfig } from '@playwright/test';

export default defineConfig( {
	testDir: './test',
	timeout: 30_000,
	fullyParallel: false,
	// One worker, not just one test per file: test/watchdog.spec.mjs's hung
	// example deliberately busy-waits the CPU for several real seconds, and
	// its own timing-based assertion (a heartbeat gap crossing a wall-clock
	// threshold) is sensitive to CPU contention from sibling test files
	// running at the same time in separate workers — observed flaking under
	// the default worker count, reliable at 1.
	workers: 1,
	webServer: {
		command: 'node server.js 5510',
		url: 'http://127.0.0.1:5510/index.html',
		reuseExistingServer: ! process.env.CI,
		timeout: 15_000,
	},
	use: {
		baseURL: 'http://127.0.0.1:5510',
		// Force out-of-process iframes even for an opaque (sandboxed,
		// allow-scripts-only) origin, which Chromium doesn't always isolate by
		// default under Playwright's own launch args — without this, a hung
		// game's busy-loop can block the HOST page's own thread too (observed
		// directly: play.js's liveness-check timer and even page.evaluate()
		// against the host stalled for the full duration of the sandboxed
		// iframe's hang), defeating the entire point of the resource watchdog
		// (work order §4.2) — the host needs a thread of its own to stay
		// responsive while the untrusted game's doesn't.
		launchOptions: { args: [ '--site-per-process' ] },
	},
} );
