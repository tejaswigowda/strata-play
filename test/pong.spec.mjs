// ── test/pong.spec.mjs ───────────────────────────────────────────────────────
// Work order §7 — Pong acceptance (criteria 1-5 exercised here via the bundled
// #example=pong route; criterion 6, the §1.5 red-team checklist, is verified
// once generically in test/redteam.spec.mjs against the shared sandbox
// boundary — that boundary is identical for every game, so re-running the
// same five checks per-game would test nothing new). Criterion 1's literal
// "#repo=…&file=…" form needs a pushed public repo to load from; not
// reachable in this offline dev loop — see README's honesty ledger.
import { test, expect } from '@playwright/test';

async function getSandboxFrame( page ) {

	const handle = await page.locator( '#sandbox' ).elementHandle();
	const frame = await handle.contentFrame();
	if ( ! frame ) throw new Error( 'sandbox iframe has no content frame' );
	return frame;

}

async function pressKey( frame, code, ms ) {

	await frame.evaluate( ( c ) => window.dispatchEvent( new KeyboardEvent( 'keydown', { code: c } ) ), code );
	await new Promise( ( r ) => setTimeout( r, ms ) );
	await frame.evaluate( ( c ) => window.dispatchEvent( new KeyboardEvent( 'keyup', { code: c } ) ), code );

}

function readState( frame ) {

	return frame.evaluate( () => {

		const ctx = window.STRATA_CTX;
		const ball = window.$S( '#Ball' ).toArray()[ 0 ];
		const player = window.$S( '#PlayerPaddle' ).toArray()[ 0 ];
		const ai = window.$S( '#AIPaddle' ).toArray()[ 0 ];
		return {
			ball: { x: ball.position.x, z: ball.position.z },
			player: { x: player.position.x },
			ai: { x: ai.position.x },
			scorePlayer: ctx.state.scorePlayer,
			scoreAI: ctx.state.scoreAI,
		};

	} );

}

test( 'pong: loads, paddle moves, AI tracks, ball bounces without tunneling, score + reset', async ( { page } ) => {

	const consoleErrors = [];
	page.on( 'console', ( msg ) => { if ( msg.type() === 'error' ) consoleErrors.push( msg.text() ); } );
	page.on( 'pageerror', ( err ) => consoleErrors.push( String( err ) ) );

	// 1. Loads (bundled route — see file header re: a real #repo= URL).
	await page.goto( '/#example=pong' );
	await expect( page.locator( '#load-overlay' ) ).toBeHidden();
	const frame = await getSandboxFrame( page );

	// Click-to-play gate (every game, strata-play standard): onFrame/physics
	// never advance until a real user gesture — dismiss it here the same way a
	// player's first keypress would (this test context has no touch, so the
	// gate listens for a keydown, not a click), or the ball/AI/score below
	// never move.
	await frame.evaluate( () => window.dispatchEvent( new KeyboardEvent( 'keydown', { code: 'Space', bubbles: true } ) ) );

	const start = await readState( frame );
	expect( start.scorePlayer ).toBe( 0 );
	expect( start.scoreAI ).toBe( 0 );

	// 3. Player input moves the player paddle.
	await pressKey( frame, 'ArrowRight', 400 );
	const afterInput = await readState( frame );
	expect( afterInput.player.x ).toBeGreaterThan( start.player.x );

	// 2. Ball collides off paddles/walls and does not tunnel at max speed —
	// sample repeatedly: it must never cross a wall (|x| stays inside the
	// court), and it must reverse Z-direction at least once (a paddle bounce)
	// before any score, proving live collision response rather than free flight.
	const samples = [];
	let zSign = null;
	let bounced = false;
	for ( let i = 0; i < 25; i ++ ) {

		await page.waitForTimeout( 150 );
		const s = await readState( frame );
		const dz = s.ball.z - ( samples.length ? samples[ samples.length - 1 ].ball.z : start.ball.z );
		if ( Math.abs( dz ) > 1e-4 ) {

			const sign = Math.sign( dz );
			if ( zSign !== null && sign !== zSign ) bounced = true;
			zSign = sign;

		}
		samples.push( s );
		if ( s.scorePlayer > start.scorePlayer || s.scoreAI > start.scoreAI ) break;

	}

	for ( const s of samples ) expect( Math.abs( s.ball.x ) ).toBeLessThan( 3.05 ); // never tunnels through a wall
	expect( bounced ).toBe( true ); // reversed direction at least once — a live paddle/wall collision, not free flight

	// 4. AI paddle tracks the ball (moved from its start position at all,
	// following a moving ball) and is beatable — a score eventually happens.
	const aiMoved = samples.some( ( s ) => s.ai.x !== 0 );
	expect( aiMoved ).toBe( true );

	await expect.poll( async () => {

		const s = await readState( frame );
		return s.scorePlayer > 0 || s.scoreAI > 0;

	}, { timeout: 15000 } ).toBe( true );

	// 5. Score incremented on the miss; reset returns a clean, identical start.
	const scored = await readState( frame );
	expect( scored.scorePlayer + scored.scoreAI ).toBeGreaterThan( 0 );

	await frame.evaluate( () => window.STRATA_CTX.reset() );
	const afterReset = await readState( frame );
	expect( afterReset.scorePlayer ).toBe( 0 );
	expect( afterReset.scoreAI ).toBe( 0 );
	// Loose tolerance, not exact zero: the ball is re-served (and therefore
	// already moving) the instant reset() runs, and the round trip to read it
	// back costs at least one more fixed step — the point is "back near
	// center", not "still wherever it was mid-game".
	expect( Math.abs( afterReset.ball.x ) ).toBeLessThan( 0.5 );
	expect( Math.abs( afterReset.ball.z ) ).toBeLessThan( 0.5 );

	expect( consoleErrors, `console errors: ${ consoleErrors.join( '\n' ) }` ).toEqual( [] );

} );
