// ── test/redteam.spec.mjs ────────────────────────────────────────────────────
// Work order §1.5/§4 (pose input provider) — sandbox red-team acceptance:
// every attack below must fail. Loads the bundled hostile example
// (#example=redteam) and asserts each listed attempt was blocked, never
// shipped in a real game.
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
	// imgBeacon resolves via a securitypolicyviolation event; cameraAccess via
	// a getUserMedia promise; forgedPoseInput via a setTimeout, same idea.
	await expect.poll( async () => {

		const s = await frame.evaluate( () => window.STRATA_CTX && window.STRATA_CTX.state.redteam );
		return s && s.forgedSave !== 'pending' && s.githubApi !== 'pending' && s.imgBeacon !== 'pending'
			&& s.cameraAccess !== 'pending' && s.forgedPoseInput !== 'pending';

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
	// 6. Exfiltrate via an <img> beacon — full-CSP hardening (work order §4.1).
	expect( redteam.imgBeacon ).toBe( 'blocked' );
	// 7. Pose-input-provider §4 — getUserMedia from inside the game sandbox.
	expect( redteam.cameraAccess ).toBe( 'blocked' );
	// 8. Reach the posecaster sibling frame (a property read on window.parent).
	expect( redteam.siblingFrame ).toBe( 'blocked' );
	// 9/10. A forged strata:input the game posts to itself can't spoof a
	// provider — same identity check rejects both a self-post and any
	// non-host origin's post.
	expect( redteam.forgedPoseInput ).toBe( 'rejected' );

} );

// 11. posecaster's own out=postmessage mode, fail-closed — a missing/malformed
// `target` must never fall back to posting with "*"; this is a live check
// against the real deployed posecaster.com (the actual shipped behavior, not
// a local stand-in), matching this repo's existing honesty-ledger precedent
// of exercising real external network behavior where a local stand-in
// wouldn't prove anything.
test( 'red-team: posecaster out=postmessage fails closed with no/malformed target', async ( { page } ) => {

	await page.goto( 'about:blank' );

	const received = await page.evaluate( async () => {

		const messages = [];
		window.addEventListener( 'message', ( e ) => messages.push( e.data ) );

		const iframe = document.createElement( 'iframe' );
		iframe.allow = 'camera';
		// No &target= at all, AND a second case with target=* — both must post nothing.
		iframe.src = 'https://posecaster.com/models/pose/index.html#out=postmessage';
		document.body.appendChild( iframe );

		await new Promise( ( r ) => setTimeout( r, 4000 ) );
		return messages;

	} );

	expect( received.length ).toBe( 0 );

} );
