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

}
