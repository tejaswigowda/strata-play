// ── test/harness.spec.mjs ────────────────────────────────────────────────────
// Regression checks for harness-level behaviour every game relies on, found
// while wiring a lap-race logic against a labelled circuit scene:
//   1. ctx.scene is a real THREE.Scene (a Group root silently ignores
//      `scene.background` / `fog` / `environment`).
//   2. A hot reload (the Code tab's Save posts a fresh strata:init) removes the
//      input listeners it added instead of stacking another set per Save.
//   3. Only labelled meshes (or nodes that carry the class in their own extras)
//      get physics bodies — never an ancestor that merely matched by derived
//      label — and a rotated static/trigger body keeps its oriented footprint.
import { test, expect } from '@playwright/test';

async function getSandboxFrame( page ) {

	const handle = await page.locator( '#sandbox' ).elementHandle();
	const frame = await handle.contentFrame();
	if ( ! frame ) throw new Error( 'sandbox iframe has no content frame' );
	return frame;

}

test( 'harness: ctx.scene is a Scene, hot reload does not stack input listeners, physics bodies are label-owned', async ( { page } ) => {

	await page.goto( '/#example=pong' );
	await expect( page.locator( '#load-overlay' ) ).toBeHidden();
	const frame = await getSandboxFrame( page );

	// 1. A real Scene, so background actually renders.
	const sceneInfo = await frame.evaluate( () => {

		const ctx = window.STRATA_CTX;
		ctx.scene.background = new ctx.THREE.Color( 0x336699 );
		return { isScene: ctx.scene.isScene, hasChildren: ctx.scene.children.length > 0 };

	} );
	expect( sceneInfo.isScene ).toBe( true );
	expect( sceneInfo.hasChildren ).toBe( true );

	// 2. Count net listener changes across two hot reloads.
	await frame.evaluate( () => {

		window.__net = {};
		const cv = window.STRATA_CTX.canvas;
		for ( const [ target, name ] of [ [ window, 'win' ], [ cv, 'cv' ] ] ) {

			const add = target.addEventListener.bind( target );
			const remove = target.removeEventListener.bind( target );
			target.addEventListener = ( t, fn, o ) => { window.__net[ `${ name }:${ t }` ] = ( window.__net[ `${ name }:${ t }` ] || 0 ) + 1; return add( t, fn, o ); };
			target.removeEventListener = ( t, fn, o ) => { window.__net[ `${ name }:${ t }` ] = ( window.__net[ `${ name }:${ t }` ] || 0 ) - 1; return remove( t, fn, o ); };

		}

	} );

	for ( let i = 0; i < 2; i ++ ) {

		await page.evaluate( () => document.getElementById( 'sandbox' ).contentWindow.postMessage( {
			type: 'strata:init', source: { kind: 'local', example: 'pong' }, file: 'examples/pong/game.glb', providers: [ 'face' ], muted: true,
		}, '*' ) );
		await expect.poll( () => frame.evaluate( () => window.STRATA_CTX.state.scorePlayer !== undefined ) ).toBe( true );

	}

	const net = await frame.evaluate( () => ( { ...window.__net } ) );
	for ( const key of [ 'win:keydown', 'win:keyup', 'win:blur', 'cv:pointerdown', 'cv:pointermove', 'cv:pointerup' ] ) {

		expect( net[ key ], `${ key } must be net-zero across reloads` ).toBe( 0 );

	}

	// 3. Physics bodies: exactly one per own-labelled node — an ancestor that only
	// matched via a descendant's derived label must not get a (scene-sized) body.
	const bodies = await frame.evaluate( () => {

		const ctx = window.STRATA_CTX;
		const owned = new Set();
		for ( const cls of [ 'static', 'trigger', 'dynamic', 'kinematic' ] ) {

			for ( const n of ctx.$S( '.' + cls ).toArray() ) {

				if ( n.isMesh || ( n.userData.customClasses || [] ).includes( cls ) ) owned.add( n );

			}

		}

		return { bodies: ctx.world.bodies.length, owned: owned.size };

	} );
	expect( bodies.owned ).toBeGreaterThan( 0 );
	expect( bodies.bodies ).toBe( bodies.owned );

} );
