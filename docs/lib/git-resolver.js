// ── git-resolver.js ────────────────────────────────────────────────────────────
// Vendored, UNCHANGED, from strata-editor/docs/editor/js/GitResolver.js — per
// the work order's "reuse strata-editor's CDN resolver, don't reinvent it".
// strata-play has no build step and is a separate repo, so "reuse" means a
// literal copy kept byte-identical rather than a bundler-level import; if
// strata-editor's resolver changes, port the diff here by hand. Every caller
// in this repo (play.js, the trusted host; runtime.js, inside the untrusted
// sandbox) uses the exact same exported API, so `#repo=owner/repo[@ref]&file=…`
// behaves identically to strata-editor's own hash-preload path.
//
// Resolves repo file READS (game.json manifest + GLB/entry-JS bytes) through
// CDN edges instead of the GitHub REST API, whose anonymous rate limit (60 req/hr
// per IP) breaks the two scenarios that matter most: a classroom behind one
// shared NAT, and an embed/present link that gets real traffic. The API is
// used only as a last-resort fallback (a CDN miss on a brand-new push, or a
// CDN outage) — never in the common load path. WRITES (commits) are
// unaffected: those inherently need the API + a token and still go through
// Menubar.Git.js's ghSend/commitFiles exactly as before.
//
// Two backends, no token required for either:
//   - jsDelivr      https://cdn.jsdelivr.net/gh/{owner}/{repo}@{ref}/{path}
//     Global edge cache, effectively unmetered for cached assets. Best for
//     present/embed (scale over freshness).
//   - raw.githubusercontent.com
//     https://raw.githubusercontent.com/{owner}/{repo}/{ref}/{path}
//     Not the API, not under the 60/hr cap, much fresher than jsDelivr. Best
//     for authoring (a student who just pushed must see the new version).
//
// Freshness gotcha (jsDelivr caches aggressively): the authoring path uses raw
// first specifically to sidestep this. A caller that needs a guaranteed-fresh
// jsDelivr read can pin an immutable `ref` (a commit SHA) via splitRepoRef's
// "@ref" syntax, or purge https://purge.jsdelivr.net/gh/{owner}/{repo}@{ref}/{path}
// out of band — this module never appends a cache-busting query itself (that
// would defeat the CDN caching the present/embed path exists to get).

const SCENE_CACHE = 'git-scene-v1'; // network-first; this cache is an OFFLINE fallback only, never preferred over a live fetch

export class SceneFetchError extends Error {

	constructor( kind, message, status ) {

		super( message );
		this.kind = kind; // 'not-found' | 'rate-limited' | 'network' | 'parse-error'
		if ( status ) this.status = status; // mirrors the old ghGetSceneJSON contract (callers check err.status === 404)

	}

}

/**
 * Split an optional "@ref" (branch, tag, or commit SHA) off a repo param
 * BEFORE it reaches parseRepo() — e.g. "owner/repo@main" or a full
 * "https://github.com/owner/repo@abc123" URL. Never required: a repo param
 * with no "@" behaves exactly as it always has (ref: null, meaning "try main
 * then master"). Purely additive — the existing #repo=owner/repo URL scheme
 * is unchanged.
 */
export function splitRepoRef( raw ) {

	const str = String( raw ).trim();
	const at = str.lastIndexOf( '@' );
	if ( at <= 0 ) return { base: str, ref: null }; // no '@', or '@' at position 0 (not this syntax)
	return { base: str.slice( 0, at ), ref: str.slice( at + 1 ) || null };

}

function encodePath( path ) {

	return path.split( '/' ).map( encodeURIComponent ).join( '/' );

}

function jsdelivrUrl( owner, repo, ref, path ) {

	return `https://cdn.jsdelivr.net/gh/${ owner }/${ repo }@${ ref }/${ encodePath( path ) }`;

}

function rawUrl( owner, repo, ref, path ) {

	return `https://raw.githubusercontent.com/${ owner }/${ repo }/${ ref }/${ encodePath( path ) }`;

}

// Backend order per mode (see the module comment above for the rationale).
function backendsFor( mode ) {

	return mode === 'present'
		? [ jsdelivrUrl, rawUrl ]
		: [ rawUrl, jsdelivrUrl ];

}

async function fetchFromCdn( url, attempt ) {

	let res;
	try {

		res = await fetch( url, { cache: 'no-store' } ); // bypass the BROWSER's own HTTP cache, not the CDN edge's

	} catch ( e ) {

		// A transient network hiccup (cold DNS, a dropped connection, a
		// momentary CDN edge failure) rejects fetch() itself rather than
		// resolving with a bad status — retry once after a short backoff
		// before giving up on this URL, since a first paint is exactly when
		// this kind of blip is most visible (cold connection, cold caches).
		if ( ! attempt ) { await new Promise( ( r ) => setTimeout( r, 400 ) ); return fetchFromCdn( url, 1 ); }
		throw new SceneFetchError( 'network', `network error fetching ${ url } — ${ e.message }` );

	}

	if ( res.status === 404 ) throw new SceneFetchError( 'not-found', `404 at ${ url }`, 404 );
	if ( ! res.ok ) throw new SceneFetchError( 'network', `HTTP ${ res.status } at ${ url }` );
	return res;

}

// Try every (ref, backend) combination in order; first success wins.
async function resolveFirst( owner, repo, refs, path, mode ) {

	const backends = backendsFor( mode );
	let lastErr = null;

	for ( const ref of refs ) {

		for ( const build of backends ) {

			try {

				const res = await fetchFromCdn( build( owner, repo, ref, path ) );
				return { res, ref };

			} catch ( e ) {

				lastErr = e;

			}

		}

	}

	throw lastErr || new SceneFetchError( 'network', 'no CDN backend attempted' );

}

function sceneCacheKey( owner, repo, path ) {

	return `https://strata.local/git-scene/${ owner }/${ repo }/${ path }`;

}

/**
 * Resolve a repo file's scene JSON: CDN first (ordered by `mode`), a cached
 * copy of the LAST successful fetch of this exact file next (offline
 * fallback only — never preferred over a live network response), and the
 * GitHub API (`apiFetch(ref)`, injected so this module never talks to
 * api.github.com directly) only as the final resort.
 *
 * `ref` — an explicit branch/tag/SHA, or null to try 'main' then 'master'.
 * Returns `{ json, ref, source }` (`source`: 'cdn' | 'api' | 'cache').
 * Throws SceneFetchError with an accurate `.kind` — a missing file is always
 * 'not-found', never misreported as 'rate-limited'.
 */
export async function resolveSceneJSON( { owner, repo, ref, path, mode, apiFetch } ) {

	const refs = ref ? [ ref ] : [ 'main', 'master' ];
	const key = sceneCacheKey( owner, repo, path );
	let cdnErr = null;

	try {

		const { res, ref: resolvedRef } = await resolveFirst( owner, repo, refs, path, mode );
		const text = await res.text();

		if ( ! text.trim() ) throw new SceneFetchError( 'parse-error', 'scene file is empty' );

		let json;
		try { json = JSON.parse( text ); } catch ( e ) { throw new SceneFetchError( 'parse-error', `scene file is not valid JSON — ${ e.message }` ); }

		putCache( key, text );

		return { json, ref: resolvedRef, source: 'cdn' };

	} catch ( e ) {

		cdnErr = e;
		if ( e.kind === 'parse-error' ) throw e; // a real file that doesn't parse — no fallback will fix that

	}

	// Every CDN attempt failed — try the GitHub API (still useful for a
	// brand-new push no CDN has cached yet, or a CDN outage).
	if ( typeof apiFetch === 'function' ) {

		const apiRef = ref || 'main';

		try {

			const json = await apiFetch( apiRef );
			putCache( key, JSON.stringify( json ) );
			return { json, ref: apiRef, source: 'api' };

		} catch ( apiErr ) {

			// A genuine 404 from the API is the most trustworthy "not found"
			// signal (a CDN 404 can also just mean "not cached yet"); otherwise
			// keep whatever the CDN attempts already told us.
			if ( apiErr && apiErr.status === 404 ) cdnErr = new SceneFetchError( 'not-found', apiErr.message, 404 );
			else if ( apiErr && apiErr.status === 403 && ( ! cdnErr || cdnErr.kind !== 'not-found' ) ) cdnErr = new SceneFetchError( 'rate-limited', apiErr.message, 403 );

		}

	}

	// Fully offline (or every live backend failed) — last resort: whatever we
	// cached from a previous successful load of this exact file.
	const cached = await getCache( key );
	if ( cached !== null ) {

		try { return { json: JSON.parse( cached ), ref: ref || 'main', source: 'cache' }; } catch { /* stale/corrupt cache entry — fall through to throwing below */ }

	}

	throw cdnErr || new SceneFetchError( 'network', 'scene file could not be resolved' );

}

/**
 * Resolve a repo file's raw BYTES (externalized geometry/image assets) the
 * same way — CDN first (ordered by `mode`), GitHub API last resort. Callers
 * that already have their own long-lived cache for content-addressed asset
 * paths (see Menubar.Git.js's ghGetBytes) should check that FIRST and only
 * call this on a miss; this function itself does no caching of its own.
 */
export async function resolveAssetBytes( { owner, repo, ref, path, mode, apiFetch } ) {

	const refs = ref ? [ ref ] : [ 'main', 'master' ];

	try {

		const { res } = await resolveFirst( owner, repo, refs, path, mode );
		return new Uint8Array( await res.arrayBuffer() );

	} catch ( cdnErr ) {

		if ( typeof apiFetch === 'function' ) return apiFetch( ref || 'main' );
		throw cdnErr;

	}

}

/**
 * Step 3 — a repo's scene list, from an index file (checked in order:
 * index.json, scenes.json) via the same CDN path, rather than an API
 * directory listing. No current caller in this codebase lists repo scenes;
 * exported for whenever a "browse this repo's scenes" UI wants it.
 * Returns the parsed index (whatever shape the repo's index file uses), or
 * null if neither file exists on any backend/ref and no `apiFetch` is given
 * (or it also fails).
 */
export async function resolveSceneIndex( { owner, repo, ref, mode, apiFetch } ) {

	for ( const path of [ 'index.json', 'scenes.json' ] ) {

		try {

			const { json } = await resolveSceneJSON( { owner, repo, ref, path, mode } );
			return json;

		} catch { /* try the next filename */ }

	}

	if ( typeof apiFetch === 'function' ) {

		try { return await apiFetch(); } catch { /* no index available */ }

	}

	return null;

}

// ── Offline-fallback cache (Cache Storage) — network-first, never authoritative ─
async function putCache( key, text ) {

	if ( typeof caches === 'undefined' ) return;
	try { const c = await caches.open( SCENE_CACHE ); await c.put( key, new Response( text ) ); } catch { /* non-fatal */ }

}

async function getCache( key ) {

	if ( typeof caches === 'undefined' ) return null;
	try {

		const c = await caches.open( SCENE_CACHE );
		const hit = await c.match( key );
		return hit ? await hit.text() : null;

	} catch {

		return null;

	}

}
