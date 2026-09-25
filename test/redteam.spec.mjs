// ── test/redteam.spec.mjs ────────────────────────────────────────────────────
// Work order §1.5 — sandbox red-team acceptance: every attack below must fail.
// Loads the bundled hostile example (#example=redteam) and asserts each of
// the five listed attempts was blocked, never shipped in a real game.
import { test, expect } from '@playwright/test';

async function getSandboxFrame( page ) {

	const handle = await page.locator( '#sandbox' ).elementHandle();
	const frame = await handle.contentFrame();
	if ( ! frame ) throw new Error( 'sandbox iframe has no content frame' );
	return frame;

}

test( 'red-team: all five attacks fail', async ( { page } ) => {

	const hostUrlBefore = 'http://127.0.0.1:5510/#example=redteam';

	await page.goto( '/#example=redteam' );
	await expect( page.locator( '#load-overlay' ) ).toBeHidden();

	const frame = await getSandboxFrame( page );

	// forgedSave/githubApi resolve asynchronously (a postMessage round trip and
	// a network attempt respectively) — poll until neither is still "pending".
	await expect.poll( async () => {

		const s = await frame.evaluate( () => window.STRATA_CTX && window.STRATA_CTX.state.redteam );
		return s && s.forgedSave !== 'pending' && s.githubApi !== 'pending';

	}, { timeout: 5000 } ).toBe( true );

	const redteam = await frame.evaluate( () => window.STRATA_CTX.state.redteam );

	// 1. Read the host's GitHub token.
	expect( redteam.token ).toBe( 'blocked' );
	// 2. Read/write host (here: this frame's own opaque-origin) storage.
	expect( redteam.ownStorage ).toBe( 'blocked' );
	// 3. Reach window.parent.document.
	expect( redteam.parentDom ).toBe( 'blocked' );
	// 3b. Navigate the top frame — the host page itself never moved.
	expect( page.url() ).toBe( hostUrlBefore );
	// 4. Call the GitHub API directly.
	expect( redteam.githubApi ).toBe( 'blocked' );
	// 5. Forge a "save" outside the game's own repo scope.
	expect( redteam.forgedSave ).toBe( 'rejected' );
	expect( redteam.forgedSaveReason ).toMatch( /scope|invalid/i );

} );
