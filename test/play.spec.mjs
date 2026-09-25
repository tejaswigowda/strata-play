// ── test/play.spec.mjs ────────────────────────────────────────────────────────
// The agent's dev/verify loop — not shipped in any game. Loads the bundled
// examples/hello demo through the real host shell (index.html -> play.js ->
// sandbox.html -> runtime.js), reaches into the sandboxed frame the same way
// any external automation would have to (there is no privileged back door),
// and asserts the acceptance criteria from the work order.
import { test, expect } from '@playwright/test';

async function getSandboxFrame( page ) {

	const handle = await page.locator( '#sandbox' ).elementHandle();
	const frame = await handle.contentFrame();
	if ( ! frame ) throw new Error( 'sandbox iframe has no content frame' );
	return frame;

}

async function waitForLoaded( page ) {

	await expect( page.locator( '#load-overlay' ) ).toBeHidden();

}

// Click-to-play gate (strata-play standard, every game): onFrame/physics never
// advance until a real user gesture — tests that depend on time-based
// progress (an animation, AI, physics) must dismiss it first, the same way a
// player's first keypress would (this test context has no touch, so the gate
// listens for a keydown, not a click).
async function dismissStartGate( frame ) {

	await frame.evaluate( () => window.dispatchEvent( new KeyboardEvent( 'keydown', { code: 'Space', bubbles: true } ) ) );

}

// Dispatches a real PointerEvent at the coin's own projected screen position —
// simulated input through the actual DOM listener runtime.js wires up, not a
// call straight into game logic.
async function clickCoinByIndex( frame, index ) {

	return frame.evaluate( ( i ) => {

		const ctx = window.STRATA_CTX;
		const coin = window.$S( '.coin' ).toArray()[ i ];
		if ( ! coin ) throw new Error( `no coin at index ${ i }` );

		const rect = ctx.canvas.getBoundingClientRect();
		const world = coin.getWorldPosition( new ctx.THREE.Vector3() ).clone().project( ctx.camera );

		const clientX = rect.left + ( world.x * 0.5 + 0.5 ) * rect.width;
		const clientY = rect.top + ( - ( world.y * 0.5 ) + 0.5 ) * rect.height;

		ctx.canvas.dispatchEvent( new PointerEvent( 'pointerdown', { clientX, clientY, bubbles: true, button: 0 } ) );

		return { visible: coin.visible };

	}, index );

}

test.describe( 'strata-play — hello example', () => {

	test( 'selectors resolve, clicking coins scores, all three open the door, no console errors', async ( { page } ) => {

		const consoleErrors = [];
		page.on( 'console', ( msg ) => { if ( msg.type() === 'error' ) consoleErrors.push( msg.text() ); } );
		page.on( 'pageerror', ( err ) => consoleErrors.push( String( err ) ) );

		await page.goto( '/' );
		await waitForLoaded( page );

		const frame = await getSandboxFrame( page );

		// ── Selectors resolve ────────────────────────────────────────────────
		const counts = await frame.evaluate( () => ( {
			coins: window.$S( '.coin' ).count,
			doors: window.$S( '#door' ).count,
		} ) );
		expect( counts.coins ).toBe( 3 );
		expect( counts.doors ).toBeGreaterThan( 0 );

		const doorStartY = await frame.evaluate( () => window.$S( '#door' ).toArray()[ 0 ].position.y );

		// ── Click each coin → state.score increments, coin hides ─────────────
		for ( let i = 0; i < 3; i ++ ) {

			const before = await frame.evaluate( () => window.STRATA_CTX.state.score );
			const result = await clickCoinByIndex( frame, i );
			expect( result.visible ).toBe( false );

			const after = await frame.evaluate( () => window.STRATA_CTX.state.score );
			expect( after ).toBe( before + 1 );

		}

		const finalScore = await frame.evaluate( () => window.STRATA_CTX.state.score );
		expect( finalScore ).toBe( 3 );

		// ── All three collected → the door opens (position changes over time) ─
		// The door's slide is driven by onFrame, which is held behind the
		// click-to-play gate until now — scoring itself (input.onPointer) never
		// was gated, matching a real player clicking coins before ever "starting".
		await dismissStartGate( frame );
		await page.waitForTimeout( 1800 );
		const doorEndY = await frame.evaluate( () => window.$S( '#door' ).toArray()[ 0 ].position.y );
		expect( doorEndY ).toBeGreaterThan( doorStartY + 0.5 );

		expect( consoleErrors, `console errors: ${ consoleErrors.join( '\n' ) }` ).toEqual( [] );

	} );

	test( 'security: sandboxed game code cannot read host localStorage or reach window.parent DOM', async ( { page } ) => {

		await page.goto( '/' );
		await page.evaluate( () => window.localStorage.setItem( 'strata-play-security-probe', 'top-secret-token' ) );
		await waitForLoaded( page );

		const frame = await getSandboxFrame( page );

		const probe = await frame.evaluate( () => {

			const result = { localStorage: 'read-ok', parentDom: 'read-ok' };

			try { window.localStorage.getItem( 'strata-play-security-probe' ); }
			catch { result.localStorage = 'blocked'; }

			try { void window.parent.document; }
			catch { result.parentDom = 'blocked'; }

			return result;

		} );

		expect( probe.localStorage ).toBe( 'blocked' );
		expect( probe.parentDom ).toBe( 'blocked' );

	} );

} );
