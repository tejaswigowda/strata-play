// ── game.js (posepuppet) ─────────────────────────────────────────────────────
// Work order §6 acceptance: a demo scene where posecaster (a sibling frame,
// never inside this sandbox — see ctx.onPose's whole reason for existing)
// drives a bone via ctx.onPose + $S-addressed bones. Moving in front of the
// camera swings #RightShoulder/#LeftShoulder, which (per the scene's own
// hierarchy — see build-scene.mjs) carries the visible arm mesh along with
// it. One bone per arm, not a full shoulder→elbow→wrist chain — the simplest
// faithful instance of "aim a bone at a live landmark"; a richer rig repeats
// this same pivot-with-a-child-mesh shape one level deeper per joint, same
// $S-addressing throughout, no 3DOM extension either way.

export const requires = [ '#RightShoulder', '#LeftShoulder', 'input:pose' ];

export default function init( ctx ) {

	const { THREE, $S, onFrame } = ctx;

	const rightShoulder = $S( '#RightShoulder' ).toArray()[ 0 ];
	const leftShoulder = $S( '#LeftShoulder' ).toArray()[ 0 ];

	// The rest pose (see build-scene.mjs) hangs each arm straight down in the
	// pivot's own local space — aiming the bone at a landmark means finding
	// the rotation that carries THIS vector to the live shoulder→wrist
	// direction, never an incremental/relative one (the exact
	// quaternion-accumulation bug documented for this repo's own tennis
	// game — see memory notes — always use an ABSOLUTE rotation here).
	const REST_DOWN = new THREE.Vector3( 0, - 1, 0 );

	// MediaPipe's landmark space is image pixels normalized to 0..1 (x right,
	// y DOWN, z roughly "closer to camera is more negative") — not three.js
	// world space (y up). Flips y (image-down -> world-up) and z (so reaching
	// toward the camera swings the arm toward the viewer, not away).
	function landmarkDelta( from, to ) {

		return new THREE.Vector3( to.x - from.x, - ( to.y - from.y ), - ( to.z - from.z ) );

	}

	function findLandmark( pose, name ) {

		return pose.find( ( lm ) => lm.name === name ) || null;

	}

	function aimShoulder( pivot, shoulderName, wristName, pose ) {

		const shoulder = findLandmark( pose, shoulderName );
		const wrist = findLandmark( pose, wristName );
		if ( ! shoulder || ! wrist ) return; // this landmark pair isn't visible this frame — leave the arm where it was, don't snap to a default

		const dir = landmarkDelta( shoulder, wrist );
		if ( dir.lengthSq() < 1e-6 ) return; // shoulder and wrist reported at the same point — no reliable direction yet
		dir.normalize();

		pivot.quaternion.setFromUnitVectors( REST_DOWN, dir );

	}

	onFrame( () => {

		const frame = ctx.input.pose();
		if ( ! frame || ! frame.pose ) return;

		aimShoulder( rightShoulder, 'RIGHT_SHOULDER', 'RIGHT_WRIST', frame.pose );
		aimShoulder( leftShoulder, 'LEFT_SHOULDER', 'LEFT_WRIST', frame.pose );

	} );

}
