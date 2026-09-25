// ── git-host.js ──────────────────────────────────────────────────────────────
// HOST-ONLY git code (never imported by anything that runs inside the sandbox
// iframe): the GitHub PAT, its localStorage home, and the write path (fork).
// `parseRepo` and the write helpers (ghHeaders/ghGet/ghSend) are adapted from
// strata-editor/docs/editor/js/Menubar.Git.js — same shapes, same
// "no token needed for public reads" rule — trimmed to what a player needs
// (parse a repo ref, hold a PAT, fork a repo). The CDN read path lives in
// git-resolver.js and is shared with the sandbox; this module is reads-plus-
// writes for the trusted host only, and is never postMessage'd anywhere.

// ── Parse owner/repo from a GitHub URL, or the bare "owner/repo" shorthand ────
// (identical logic to Menubar.Git.js's parseRepo)
export function parseRepo( url ) {

	const str = String( url ).trim().replace( /\.git$/, '' );

	const m = str.match( /github\.com[/:]([^/]+)\/([^/]+)/ );
	if ( m ) return { owner: m[ 1 ], repo: m[ 2 ] };

	const shorthand = str.match( /^([\w.-]+)\/([\w.-]+)$/ );
	if ( shorthand ) return { owner: shorthand[ 1 ], repo: shorthand[ 2 ] };

	return null;

}

// ── Token storage (host-only localStorage; NEVER read inside the sandbox) ────
const LS_KEY = 'strata-play-git';

export function loadSettings() {

	try { return JSON.parse( localStorage.getItem( LS_KEY ) ) || {}; } catch { return {}; }

}

export function saveSettings( s ) {

	localStorage.setItem( LS_KEY, JSON.stringify( s ) );

}

// ── GitHub REST helpers (writes only need these; reads go through the CDN
// resolver and never touch api.github.com in the hot path) ───────────────────

function ghHeaders( token, accept ) {

	const headers = { Accept: accept || 'application/vnd.github+json' };
	if ( token ) headers.Authorization = `Bearer ${ token }`;
	return headers;

}

async function ghGet( path, token ) {

	const res = await fetch( `https://api.github.com${ path }`, { headers: ghHeaders( token ), cache: 'no-store' } );
	if ( ! res.ok ) throw new Error( `GitHub ${ res.status }: ${ await res.text() }` );
	return res.json();

}

async function ghSend( method, path, token, body ) {

	const res = await fetch( `https://api.github.com${ path }`, {
		method,
		headers: { ...ghHeaders( token ), 'Content-Type': 'application/json' },
		body: body ? JSON.stringify( body ) : undefined,
	} );

	if ( ! res.ok ) {

		const err = new Error( `GitHub ${ res.status }: ${ await res.text() }` );
		err.status = res.status;
		throw err;

	}

	return res.status === 202 || res.status === 204 ? null : res.json();

}

/**
 * Who does this token belong to? Needed to know where GitHub put the fork
 * (always under the authenticated user's account, or an org they chose — we
 * only support the default "my account" target here).
 */
export async function getAuthedUser( token ) {

	return ghGet( '/user', token );

}

/**
 * Fork `owner/repo` into the token owner's account (POST /repos/{o}/{r}/forks).
 * GitHub queues large forks asynchronously, but a small game repo is normally
 * ready immediately; callers should still expect the freshly-forked repo's
 * default branch to occasionally need a few seconds before its first CDN read
 * succeeds (a plain 404-retry, same as any brand-new push — see
 * git-resolver.js's module comment on CDN freshness).
 * Returns `{ owner, repo, full_name, default_branch }` for the new fork.
 */
export async function forkRepo( owner, repo, token ) {

	if ( ! token ) throw new Error( 'A token is required to fork' );

	const fork = await ghSend( 'POST', `/repos/${ owner }/${ repo }/forks`, token, {} );

	return {
		owner: fork.owner && fork.owner.login,
		repo: fork.name,
		full_name: fork.full_name,
		default_branch: fork.default_branch || 'main',
	};

}
