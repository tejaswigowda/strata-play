// ── test/watchdog.spec.mjs ────────────────────────────────────────────────────
// Work order §4.2 — resource watchdog acceptance: an intentionally hung
// example game (#example=hung, see examples/hung/game.js) wedges its own
// thread on its first onFrame tick for effectively the rest of this test's
// own lifetime (deliberately NOT just "a bit longer than the timeout" — see
// that file's own comment for why a bounded, self-recovering hang would race
// against the liveness check instead of reliably tripping it). The host's
// liveness check (play.js: 'strata:heartbeat' polling) must notice the gap
// and offer to stop it, and "Stop game" must actually tear the sandbox down
// (a destructive navigation, never needing the hung script's cooperation).
import { test, expect } from '@playwright/test';

async function getSandboxFrame( page ) {

	const handle = await page.locator( '#sandbox' ).elementHandle();
	const frame = await handle.contentFrame();
	if ( ! frame ) throw new Error( 'sandbox iframe has no content frame' );
	return frame;

}

test( 'resource watchdog: a hung game trips the liveness check, Stop tears it down', async ( { page } ) => {

	test.setTimeout( 20000 );

	await page.goto( '/#example=hung' );
	await expect( page.locator( '#load-overlay' ) ).toBeHidden();
	await expect( page.locator( '#watchdog-overlay' ) ).toBeHidden(); // never shows during normal loading

	// A bare #example= route (no #repo=) auto-opens the menu with a "no repo
	// configured" hint (see play.js's boot sequence) — close it so it never
	// intercepts the later click on the watchdog prompt's own Stop button.
	await page.click( '#menu-close-btn' );

	const frame = await getSandboxFrame( page );

	// Click-to-play gate — dismissing it is what starts onFrame, which is
	// where examples/hung/game.js's deliberate hang begins.
	await frame.evaluate( () => window.dispatchEvent( new KeyboardEvent( 'keydown', { code: 'Space', bubbles: true } ) ) );

	// The prompt should appear once heartbeats stop for long enough
	// (WATCHDOG_TIMEOUT_MS in play.js) — the hang never ends on its own within
	// this test, so there's no race against a recovery heartbeat to worry about.
	await expect( page.locator( '#watchdog-overlay' ) ).toBeVisible( { timeout: 10000 } );

	await page.click( '#watchdog-stop-btn' );
	await expect( page.locator( '#watchdog-overlay' ) ).toBeHidden();
	await expect( page.locator( '#status' ) ).toHaveText( /stopped responding/i );

	// Tearing down actually navigated the iframe away, not just hid the prompt.
	await expect( page.locator( '#sandbox' ) ).toHaveAttribute( 'src', 'about:blank' );

} );
