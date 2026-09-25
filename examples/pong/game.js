// ── game.js (Pong) ──────────────────────────────────────────────────────────
// Work order §7 — the first shipped, forkable game. Labels do the physics
// wiring (Court/Wall * -> .static, Player/AIPaddle -> .kinematic, Ball ->
// .dynamic with CCD) — this file is just input, a ~5-line AI follow, and
// score/reset, same as any game written against the plain ctx contract.

export default function init( ctx ) {

	const { $S, input, onFrame, onReset, state, getBody } = ctx;

	const player = $S( '#PlayerPaddle' ).toArray()[ 0 ];
	const ai = $S( '#AIPaddle' ).toArray()[ 0 ];
	const ball = $S( '#Ball' ).toArray()[ 0 ];
	const ballBody = getBody( ball );

	const HALF_WIDTH = 2.5;      // paddle travel clamp along X
	const PLAYER_SPEED = 5;      // units/sec
	const AI_SPEED = 2.6;        // capped below the player's — beatable
	const SERVE_SPEED = 3.5;
	const OUT_OF_BOUNDS_Z = 5.2; // just past each paddle's Z plane

	state.scorePlayer = 0;
	state.scoreAI = 0;

	function serve( towardPlayer ) {

		ball.position.set( 0, ball.position.y, 0 );
		ballBody.position.set( 0, ball.position.y, 0 );
		ballBody.velocity.set( ( Math.random() * 2 - 1 ) * 0.6 * SERVE_SPEED, 0, ( towardPlayer ? 1 : - 1 ) * SERVE_SPEED );
		ballBody.angularVelocity.set( 0, 0, 0 );

	}

	onReset( () => { state.scorePlayer = 0; state.scoreAI = 0; serve( true ); } );

	serve( true );

	onFrame( ( dt ) => {

		// Player input — arrow keys / A-D (a touch/pointer drag falls back to
		// the SAME axis() call; see sandbox.html's makeInput).
		const axis = input.axis( [ 'ArrowLeft', 'KeyA' ], [ 'ArrowRight', 'KeyD' ] );
		player.position.x = Math.max( - HALF_WIDTH, Math.min( HALF_WIDTH, player.position.x + axis * PLAYER_SPEED * dt ) );

		// AI: lerp toward the ball, clamped + speed-capped (beatable). No ML.
		const diff = ball.position.x - ai.position.x;
		const step = Math.max( - AI_SPEED * dt, Math.min( AI_SPEED * dt, diff ) );
		ai.position.x = Math.max( - HALF_WIDTH, Math.min( HALF_WIDTH, ai.position.x + step ) );

		// Score + deterministic reset once the ball passes a paddle's Z plane.
		if ( ball.position.z > OUT_OF_BOUNDS_Z ) { state.scoreAI ++; serve( false ); }
		else if ( ball.position.z < - OUT_OF_BOUNDS_Z ) { state.scorePlayer ++; serve( true ); }

	} );

}
