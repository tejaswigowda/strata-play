// ── game.js ──────────────────────────────────────────────────────────────────
// The seed example's entry module — plain JS against the ctx contract, no
// 3DOM extension. A game repo is just two files: this and game.glb — the
// entry's filename always matches the scene's own basename with a .js
// extension (auto-resolved, no separate manifest). Click each `.coin` to
// collect it (it hides, state.score++); once all three are collected, `#door`
// slides open.
//
// This is the pattern any game entry follows: default-export init(ctx), wire
// input, register onFrame for anything that animates, read/write ctx.state.

export default function init( ctx ) {

	const { $S, input, onFrame, state } = ctx;

	state.score = 0;
	state.doorOpen = false;

	const TOTAL_COINS = $S( '.coin' ).count;
	const doorOpenDistance = 2.2; // units to slide up before considering the door "open"
	let doorAnimating = false;

	input.onPointer( ( ev ) => {

		if ( ev.type !== 'down' ) return;

		const ray = input.pointerRay();
		if ( ! ray ) return;

		const coins = $S( '.coin' ).toArray().filter( ( n ) => n.visible );
		if ( coins.length === 0 ) return;

		const hits = ray.intersectObjects( coins, false );
		if ( hits.length === 0 ) return;

		$S( [ hits[ 0 ].object ] ).setVisible( false );
		state.score ++;

		if ( state.score >= TOTAL_COINS && ! state.doorOpen ) {

			state.doorOpen = true;
			doorAnimating = true;

		}

	} );

	onFrame( ( dt ) => {

		if ( ! doorAnimating ) return;

		const door = $S( '#door' ).toArray()[ 0 ];
		if ( ! door ) { doorAnimating = false; return; }

		if ( door.userData._openTravel === undefined ) door.userData._openTravel = 0;

		const step = dt * 1.4;
		const remaining = doorOpenDistance - door.userData._openTravel;

		if ( remaining <= 0 ) { doorAnimating = false; return; }

		const move = Math.min( step, remaining );
		$S( [ door ] ).move( 0, move, 0 );
		door.userData._openTravel += move;

	} );

}
