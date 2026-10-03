// ── game.js (hung) ───────────────────────────────────────────────────────────
// Deliberately wedges its own thread on the very first frame — a stand-in for
// a real hung loop/runaway spawn/mining script (work order §4.2). Scene is
// just the bundled "hello" scene reused as-is; this game never touches it,
// only ctx.onFrame. Exists purely so test/watchdog.spec.mjs can prove the
// host's resource-watchdog liveness check actually trips when the sandbox's
// own render loop stalls.
//
// Deliberately long (effectively "never" within a test's own lifetime), NOT
// just "a bit longer than the host's timeout" — a bounded hang that recovers
// ON ITS OWN creates a genuine race between the host's periodic liveness
// check and the heartbeats that resume the instant this returns (whichever a
// JS engine happens to run first once unblocked), which is exactly what a
// REAL permanently-hung game never has to win: it never recovers, so the
// check is guaranteed to eventually observe the gap and stays tripped. Stop
// (play.js) tears the hung frame down via a destructive navigation
// (iframe.src = 'about:blank'), which a browser can always do regardless of
// whatever the old document's script is busy doing — it never needs this
// loop's cooperation to end.

export default function init( ctx ) {

	let hungOnce = false;

	ctx.onFrame( () => {

		if ( hungOnce ) return;
		hungOnce = true;

		const start = performance.now();
		while ( performance.now() - start < 15000 ) { /* intentionally busy */ }

	} );

}

