// ── game.js (Pong) ──────────────────────────────────────────────────────────
// Work order §7 — the first shipped, forkable game. Labels do the physics
// wiring (Court/Wall * -> .static, Player/AIPaddle -> .kinematic, Ball ->
// .dynamic with CCD) — this file is just input, a ~5-line AI follow, and
// score/reset, same as any game written against the plain ctx contract.
//
// §2 of the "one logic, many scenes" work order: every court/paddle/ball
// dimension below is DERIVED from the loaded scene's own labelled bounds
// (Box3().setFromObject — same pattern examples/bubbles already used), never
// hardcoded, so this SAME file also drives a differently-sized court with no
// changes — the proof that "one logic, many scenes" is real, not just
// claimed. `requires` lets the host validate a scene is actually compatible
// before init() ever runs, instead of a silent dead canvas.
//
// Input providers work order — 'input:face' adds posecaster's short-range
// face-detection model as a SECOND way to move the player paddle (lean left/
// right in front of the camera), layered on top of the original keyboard
// control rather than replacing it: keyboard still works right up until the
// first face frame arrives, same file either way.

export const requires = [ '#Court', '#PlayerPaddle', '#AIPaddle', '#Ball', 'input:face' ];

export default function init( ctx ) {

	const { THREE, $S, input, onFrame, onReset, state, getBody } = ctx;

	const court = $S( '#Court' ).toArray()[ 0 ];
	const player = $S( '#PlayerPaddle' ).toArray()[ 0 ];
	const ai = $S( '#AIPaddle' ).toArray()[ 0 ];
	const ball = $S( '#Ball' ).toArray()[ 0 ];
	const ballBody = getBody( ball );

	const courtBox = new THREE.Box3().setFromObject( court );
	const paddleSize = new THREE.Box3().setFromObject( player ).getSize( new THREE.Vector3() );
	const ballRadius = new THREE.Box3().setFromObject( ball ).getSize( new THREE.Vector3() ).x / 2;

	const HALF_WIDTH = courtBox.max.x - paddleSize.x / 2; // paddle travel clamp along X — stops exactly at the walls
	const PLAYER_SPEED = 5;      // units/sec — gameplay pacing, not a scene dimension, stays authored
	const AI_SPEED = 2.6;        // capped below the player's — beatable
	const SERVE_SPEED = 3.5;
	// Just past each paddle's OWN far edge (its Z position + half-depth) plus
	// a ball's width of clearance — scales with the scene, never hardcoded.
	const OUT_OF_BOUNDS_Z = Math.abs( player.position.z ) + paddleSize.z / 2 + ballRadius * 2;

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

	// Latest face-detection sample's normalized x (0=camera's left edge,
	// 1=camera's right edge), or null until the first frame arrives — never
	// mirrored, so leaning toward the camera's left moves the paddle toward
	// -X, matching whichever edge the scene's own court labels its -X wall.
	let latestFaceX = null;
	ctx.onFace( ( frame ) => {

		const c = frame.face && frame.face.find( ( lm ) => lm.name === 'face_faceCenter' );
		if ( c ) latestFaceX = c.x;

	} );

	onFrame( ( dt ) => {

		// Player input — face position (once available) takes over from
		// keyboard/touch entirely, same clamp either way.
		if ( latestFaceX !== null ) {

			const target = ( latestFaceX - 0.5 ) * 2 * HALF_WIDTH;
			player.position.x = Math.max( - HALF_WIDTH, Math.min( HALF_WIDTH, target ) );

		} else {

			const axis = input.axis( [ 'ArrowLeft', 'KeyA' ], [ 'ArrowRight', 'KeyD' ] );
			player.position.x = Math.max( - HALF_WIDTH, Math.min( HALF_WIDTH, player.position.x + axis * PLAYER_SPEED * dt ) );

		}

		// AI: lerp toward the ball, clamped + speed-capped (beatable). No ML.
		const diff = ball.position.x - ai.position.x;
		const step = Math.max( - AI_SPEED * dt, Math.min( AI_SPEED * dt, diff ) );
		ai.position.x = Math.max( - HALF_WIDTH, Math.min( HALF_WIDTH, ai.position.x + step ) );

		// Score + deterministic reset once the ball passes a paddle's Z plane.
		if ( ball.position.z > OUT_OF_BOUNDS_Z ) { state.scoreAI ++; serve( false ); }
		else if ( ball.position.z < - OUT_OF_BOUNDS_Z ) { state.scorePlayer ++; serve( true ); }

	} );

}
