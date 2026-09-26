// ── play.js ──────────────────────────────────────────────────────────────────
// Host-side controller (TRUSTED — runs in index.html's own origin, holds the
// GitHub token, never runs a byte of game code itself). Responsibilities:
//   1. Parse `#repo=owner/repo[@ref]&file=<name>.glb` (or fall back to a
//      bundled example when the hash is absent) — there is no separate
//      manifest file; `file` points straight at the scene .glb, and its
//      entry module is always the same basename with a .js extension.
//   2. Render the chrome-light shell (title, fullscreen, restart, fork,
//      open-source link) and the sandboxed <iframe> — no CDN read happens
//      here at all; the sandbox resolves and fetches its own bytes.
//   3. Hand the repo coordinates + .glb path to the sandbox over
//      postMessage — never the token, never scene/asset bytes (the sandbox
//      fetches those itself straight from the CDN, same resolver, its own
//      network request).
//
// The sandbox iframe is created with sandbox="allow-scripts" and WITHOUT
// allow-same-origin (see index.html) — it gets an opaque origin, so it can
// never read this page's localStorage (where the PAT lives) or touch
// window.parent's DOM. postMessage is the only channel, and this file only
// ever sends { source, file } into it.

import { splitRepoRef, resolveAssetBytes } from './lib/git-resolver.js';
import { parseRepo, loadSettings, saveSettings, forkRepo, commitFile } from './lib/git-host.js';

const DEFAULT_EXAMPLE = 'hello';

// A malicious game's forged "save" (work order §1.3/§1.5#5) must never be
// acted on even when the size looks plausible — enforce a cap regardless.
const MAX_SAVE_BYTES = 5 * 1024 * 1024;

const els = {
	iframe: document.getElementById( 'sandbox' ),
	title: document.getElementById( 'game-title' ),
	status: document.getElementById( 'status' ),
	overlay: document.getElementById( 'load-overlay' ),
	overlayMsg: document.getElementById( 'load-message' ),
	restartBtn: document.getElementById( 'restart-btn' ),
	fullscreenBtn: document.getElementById( 'fullscreen-btn' ),
	forkBtn: document.getElementById( 'fork-btn' ),
	openSourceLink: document.getElementById( 'open-source-link' ),
	menuBtn: document.getElementById( 'menu-btn' ),
	menuOverlay: document.getElementById( 'menu-overlay' ),
	menuCloseBtn: document.getElementById( 'menu-close-btn' ),
	menuNewBtn: document.getElementById( 'menu-new' ),
	menuExamplesBtn: document.getElementById( 'menu-examples' ),
	menuLoadHint: document.getElementById( 'menu-load-hint' ),
	menuRepoInput: document.getElementById( 'menu-repo' ),
	menuCommitInput: document.getElementById( 'menu-commit' ),
	menuFileInput: document.getElementById( 'menu-file' ),
	menuPresentInput: document.getElementById( 'menu-present' ),
	menuLoadBtn: document.getElementById( 'menu-load' ),
	menuTokenInput: document.getElementById( 'menu-token' ),
	menuTokenSaveBtn: document.getElementById( 'menu-token-save' ),
	menuCommitHeading: document.getElementById( 'menu-commit-heading' ),
	menuCommitHint: document.getElementById( 'menu-commit-hint' ),
	menuCommitTarget: document.getElementById( 'menu-commit-target' ),
	menuCommitPathField: document.getElementById( 'menu-commit-path-field' ),
	menuCommitContentField: document.getElementById( 'menu-commit-content-field' ),
	menuCommitMessageField: document.getElementById( 'menu-commit-message-field' ),
	menuCommitBtn: document.getElementById( 'menu-commit-btn' ),
	menuCommitPathInput: document.getElementById( 'menu-commit-path' ),
	menuCommitContentInput: document.getElementById( 'menu-commit-content' ),
	menuCommitMessageInput: document.getElementById( 'menu-commit-message' ),
};

let current = null; // { source, dir, file, title }
let pendingForkAfterToken = false; // set when Fork opened the menu to collect a missing token

// ── Hash parsing ───────────────────────────────────────────────────────────
// #repo=<owner>/<repo>[@ref]&file=<path>[&branch=<branch>][&commit=<sha|tag>]
// [&present=true|preview=true] — identical param names/precedence to
// strata-editor's loadSceneFromHash (Menubar.Git.js): &commit= wins over
// &branch=, which wins over an "@ref" on repo=, which wins over nothing
// (try 'main' then 'master').
function parseHash() {

	const hash = window.location.hash;
	if ( ! hash || hash.indexOf( 'repo=' ) === - 1 ) return null;

	let params;
	try { params = new URLSearchParams( hash.replace( /^#+/, '' ) ); }
	catch { return null; }

	const repoParam = params.get( 'repo' );
	const file = params.get( 'file' );
	if ( ! repoParam || ! file ) return null;

	const { base, ref: repoRef } = splitRepoRef( repoParam );
	const parsed = parseRepo( base );
	if ( ! parsed ) {

		console.warn( `strata-play: "${ repoParam }" is not a valid GitHub repo — ignoring hash.` );
		return null;

	}

	const branchParam = params.get( 'branch' );
	const commitParam = params.get( 'commit' );
	const present = params.get( 'present' ) === 'true' || params.get( 'preview' ) === 'true';

	return {
		owner: parsed.owner,
		repo: parsed.repo,
		ref: commitParam || branchParam || repoRef || null,
		file,
		mode: present ? 'present' : 'authoring',
	};

}

function dirOf( filePath ) {

	const i = filePath.lastIndexOf( '/' );
	return i === - 1 ? '' : filePath.slice( 0, i );

}

// #example=<name> picks which BUNDLED example the "new"/local route boots
// (defaults to "hello") — e.g. #example=redteam for the §1.5 security self-test.
// Independent of #repo=; only consulted when there's no repo hash.
function parseExampleName() {

	const hash = window.location.hash;
	if ( ! hash ) return DEFAULT_EXAMPLE;

	try {

		const params = new URLSearchParams( hash.replace( /^#+/, '' ) );
		return params.get( 'example' ) || DEFAULT_EXAMPLE;

	} catch { return DEFAULT_EXAMPLE; }

}

// Sandbox → host save request (work order §1.3): data only, never code, never
// eval'd/dynamically imported. Allowlisted path must stay within the loaded
// game's own repo/dir and under the size cap — anything else is rejected.
// strata-play never actually commits during play (it isn't an editor — see
// the guardrails in README), so even a request that PASSES validation is
// still only acked, never acted on; the reason string says which.
function validateSaveRequest( msg, loaded ) {

	if ( typeof msg.path !== 'string' || ! msg.path ) return 'invalid path';
	if ( typeof msg.bytes !== 'number' || ! Number.isFinite( msg.bytes ) || msg.bytes < 0 ) return 'invalid size';
	if ( msg.bytes > MAX_SAVE_BYTES ) return `payload too large (${ msg.bytes } > ${ MAX_SAVE_BYTES } bytes)`;

	const normalized = msg.path.replace( /^\/+/, '' );
	if ( normalized.split( '/' ).includes( '..' ) ) return 'path escapes game scope (contains "..")';

	const scope = loaded.dir ? `${ loaded.dir }/` : '';
	if ( scope && ! normalized.startsWith( scope ) ) return `path is outside this game's own scope ("${ scope }")`;

	return null; // validation passed — caller still only acks (see comment above)

}

// A title for the chrome bar, derived — there's no manifest to read one from.
function titleFromFile( file ) {

	const base = file.split( '/' ).pop().replace( /\.glb$/i, '' );
	return base.charAt( 0 ).toUpperCase() + base.slice( 1 );

}

// ── Load resolution ────────────────────────────────────────────────────────────
// Two routes only: a #repo= hash points straight at a real repo's .glb;
// anything else (including no hash at all) routes to "new" — a fresh local
// game, seeded from a bundled example (same-origin, no CDN needed, no fetch
// at all — the sandbox reads its bytes from its own embedded copy).
// "Examples" (a curated picker of bundled seeds) is menu-only and disabled
// for now — there's only the one template to route to today.

function resolveGitSource( hashSource ) {

	return {
		source: { kind: 'git', owner: hashSource.owner, repo: hashSource.repo, ref: hashSource.ref, mode: hashSource.mode },
		file: hashSource.file,
		dir: dirOf( hashSource.file ),
		title: titleFromFile( hashSource.file ),
	};

}

function loadNewLocalGame() {

	const example = parseExampleName();
	const file = `examples/${ example }/game.glb`;

	return {
		source: { kind: 'local', example },
		file,
		dir: dirOf( file ),
		title: titleFromFile( file ),
	};

}

// ── UI helpers ────────────────────────────────────────────────────────────────

function setStatus( text ) {

	els.status.textContent = text || '';

}

function showOverlay( text ) {

	els.overlayMsg.textContent = text || '';
	els.overlay.hidden = false;

}

function hideOverlay() {

	els.overlay.hidden = true;

}

function updateChromeFor( loaded ) {

	const { source, file, title } = loaded;
	els.title.textContent = title || 'Strata Play';
	document.title = title ? `${ title } — Strata Play` : 'Strata Play';

	if ( source.kind === 'git' ) {

		const treeRef = source.ref || 'main'; // best-effort display only — the sandbox's own resolver tries main/master if this guess is wrong
		els.openSourceLink.href = `https://github.com/${ source.owner }/${ source.repo }/tree/${ treeRef }/${ dirOf( file ) }`;
		els.openSourceLink.hidden = false;
		els.forkBtn.hidden = false;

	} else {

		els.openSourceLink.hidden = true;
		els.forkBtn.hidden = true; // nothing to fork — this is a locally-bundled example

	}

}

// ── Sandbox lifecycle (postMessage handshake) ────────────────────────────────
// The sandbox posts 'strata:ready' the instant its own listener is attached
// (before it does any loading), so the host never races a postMessage against
// a listener that isn't there yet.

function bootSandbox( loaded ) {

	current = loaded;
	updateChromeFor( loaded );
	showOverlay( 'Loading game…' );

	const onMessage = ( event ) => {

		if ( event.source !== els.iframe.contentWindow ) return; // only ever our own sandbox
		const msg = event.data;
		if ( ! msg || typeof msg !== 'object' ) return;

		if ( msg.type === 'strata:ready' ) {

			els.iframe.contentWindow.postMessage( {
				type: 'strata:init',
				source: loaded.source,
				file: loaded.file,
			}, '*' );

		} else if ( msg.type === 'strata:loaded' ) {

			hideOverlay();
			setStatus( '' );

		} else if ( msg.type === 'strata:error' ) {

			hideOverlay();
			setStatus( `Error: ${ msg.message || 'unknown error' }` );
			console.error( 'strata-play sandbox error:', msg.message );

		} else if ( msg.type === 'strata:fork-requested' ) {

			// Reserved for a future in-canvas fork prompt — today the Fork
			// button below is the primary entry point. Handled here too so the
			// message contract is honored regardless of which side triggers it.
			forkAndReload();

		} else if ( msg.type === 'strata:save' ) {

			// Work order §1.3/§1.5#5: validate before doing anything else, and
			// never actually commit during play (see validateSaveRequest's
			// comment) — a well-formed request is acked the same as a rejected
			// one, just with a different reason string.
			const reason = validateSaveRequest( msg, loaded ) || 'strata-play does not save during play (not an editor)';
			els.iframe.contentWindow.postMessage( { type: 'strata:save-rejected', reason }, '*' );

		}
		// Any other message type is silently ignored — allowlist, not denylist.

	};

	window.addEventListener( 'message', onMessage );
	els.iframe._strataCleanup = () => window.removeEventListener( 'message', onMessage );

	els.iframe.src = 'sandbox.html';

}

function restart() {

	if ( ! current ) return;
	if ( els.iframe._strataCleanup ) els.iframe._strataCleanup();
	els.iframe.src = 'about:blank';
	requestAnimationFrame( () => bootSandbox( current ) );

}

// ── Menu ("New" / "Examples" / Git load) ──────────────────────────────────────

function openMenu( hint ) {

	// Pre-fill the git-load fields from whatever's currently loaded, so the
	// menu also doubles as "what am I playing" and is easy to tweak/re-share.
	if ( current && current.source.kind === 'git' ) {

		els.menuRepoInput.value = `${ current.source.owner }/${ current.source.repo }`;
		els.menuCommitInput.value = current.source.ref || '';
		els.menuFileInput.value = current.file;
		els.menuPresentInput.checked = current.source.mode === 'present';

	}

	els.menuLoadHint.textContent = hint || '';
	els.menuLoadHint.hidden = ! hint;

	populateCommitSection();

	els.menuOverlay.hidden = false;

}

function closeMenu() {

	els.menuOverlay.hidden = true;

}

function startNew() {

	closeMenu();
	if ( els.iframe._strataCleanup ) els.iframe._strataCleanup();
	if ( window.location.hash ) window.location.hash = '';

	bootSandbox( loadNewLocalGame() );

}

// ── Fork ──────────────────────────────────────────────────────────────────────

// ── Load from repo (menu's "Git" controls) ────────────────────────────────────
// Same #repo=&commit=&file=&present= scheme parseHash() already reads —
// this just builds that hash from the menu's form fields instead of the user
// typing it by hand, then reloads (the boot sequence at the bottom of this
// file is what actually resolves it).

function loadFromMenu() {

	const repo = els.menuRepoInput.value.trim();
	const commit = els.menuCommitInput.value.trim();
	const file = els.menuFileInput.value.trim() || 'game.glb';
	const present = els.menuPresentInput.checked;

	if ( ! repo ) { els.menuRepoInput.focus(); return; }

	const params = new URLSearchParams();
	params.set( 'repo', repo );
	params.set( 'file', file );
	if ( commit ) params.set( 'commit', commit );
	if ( present ) params.set( 'present', 'true' );

	window.location.hash = params.toString();
	window.location.reload();

}

// ── Fork ──────────────────────────────────────────────────────────────────────

function tokenOrPrompt() {

	const settings = loadSettings();
	if ( settings.pat ) return settings.pat;
	pendingForkAfterToken = true;
	openMenu();
	els.menuTokenInput.focus();
	return null;

}

async function forkAndReload() {

	if ( ! current || current.source.kind !== 'git' ) return;

	const token = tokenOrPrompt();
	if ( ! token ) return; // menu now open on the token field; user retries after saving

	const { owner, repo } = current.source;
	setStatus( `Forking ${ owner }/${ repo }…` );

	try {

		const fork = await forkRepo( owner, repo, token );
		const params = new URLSearchParams();
		params.set( 'repo', `${ fork.owner }/${ fork.repo }` );
		params.set( 'file', current.file );
		params.set( 'branch', fork.default_branch );
		window.location.hash = params.toString();
		setStatus( `✓ Forked to ${ fork.full_name } — reloading…` );
		window.location.reload();

	} catch ( err ) {

		setStatus( `Fork failed: ${ err.message }` );

	}

}

// ── Commit changes ──────────────────────────────────────────────────────────────
// A deliberate, EXPLICIT, user-initiated write from this trusted host UI —
// unrelated to the sandbox's own `strata:save` postMessage path below, which
// this file still only ever acks and never acts on (see validateSaveRequest).
// A game's own code still cannot get anything committed; only a person
// looking at this menu, with their own token, can.

let commitEntryLoaded = false; // avoid re-fetching the entry's content every time the menu re-opens

async function populateCommitSection() {

	const isGit = !! ( current && current.source.kind === 'git' );
	els.menuCommitHeading.hidden = ! isGit;
	els.menuCommitHint.hidden = ! isGit;
	els.menuCommitPathField.hidden = ! isGit;
	els.menuCommitContentField.hidden = ! isGit;
	els.menuCommitMessageField.hidden = ! isGit;
	els.menuCommitBtn.hidden = ! isGit;

	if ( ! isGit ) return;

	const { owner, repo, ref, mode } = current.source;
	const branch = ref || 'main'; // best-effort — see git-host.js's commitFile comment
	els.menuCommitTarget.textContent = `${ owner }/${ repo }@${ branch }`;

	if ( commitEntryLoaded ) return; // don't clobber in-progress edits on a later menu re-open
	commitEntryLoaded = true;

	const entryPath = current.file.replace( /\.glb$/i, '.js' );
	els.menuCommitPathInput.value = entryPath;
	els.menuCommitMessageInput.value = `Update ${ entryPath }`;

	try {

		const bytes = await resolveAssetBytes( { owner, repo, ref, path: entryPath, mode } );
		els.menuCommitContentInput.value = new TextDecoder( 'utf-8' ).decode( bytes );

	} catch {

		els.menuCommitContentInput.value = ''; // no entry module yet — a blank start is fine, this is a text editor, not a diff tool

	}

}

async function commitChanges() {

	if ( ! current || current.source.kind !== 'git' ) return;

	const token = tokenOrPrompt();
	if ( ! token ) return; // menu now open on the token field; user retries after saving

	const path = els.menuCommitPathInput.value.trim();
	const content = els.menuCommitContentInput.value;
	const message = els.menuCommitMessageInput.value.trim() || `Update ${ path }`;
	if ( ! path ) { els.menuCommitPathInput.focus(); return; }

	const { owner, repo, ref } = current.source;
	const branch = ref || 'main';
	setStatus( `Committing ${ path } to ${ owner }/${ repo }@${ branch }…` );

	try {

		await commitFile( owner, repo, path, content, message, branch, token );
		setStatus( `✓ Committed ${ path }` );

	} catch ( err ) {

		setStatus( `Commit failed: ${ err.message }` );

	}

}

// ── Wire up chrome ────────────────────────────────────────────────────────────

els.restartBtn.addEventListener( 'click', restart );

els.fullscreenBtn.addEventListener( 'click', () => {

	const el = els.iframe.closest( '.stage' ) || els.iframe;
	if ( document.fullscreenElement ) document.exitFullscreen();
	else el.requestFullscreen().catch( () => {} );

} );

els.forkBtn.addEventListener( 'click', forkAndReload );

els.menuLoadBtn.addEventListener( 'click', loadFromMenu );

els.menuTokenSaveBtn.addEventListener( 'click', () => {

	const pat = els.menuTokenInput.value.trim();
	if ( ! pat ) return;
	saveSettings( { ...loadSettings(), pat } );
	els.menuTokenInput.value = '';

	if ( pendingForkAfterToken ) { pendingForkAfterToken = false; forkAndReload(); }

} );

els.menuCommitBtn.addEventListener( 'click', commitChanges );

els.menuBtn.addEventListener( 'click', () => openMenu() ); // NOT `openMenu` directly — the click's own PointerEvent would leak in as `hint`
els.menuNewBtn.addEventListener( 'click', startNew );
els.menuCloseBtn.addEventListener( 'click', closeMenu );

els.menuOverlay.addEventListener( 'click', ( ev ) => {

	if ( ev.target === els.menuOverlay ) closeMenu(); // backdrop click only

} );

// ── Boot ──────────────────────────────────────────────────────────────────────
// No #repo= hash still boots straight into the bundled example (always
// immediately playable) but ALSO opens the menu on the Load-from-repo form
// with a hint — a bare visit otherwise looks configured when it isn't.

const hashSource = parseHash();
const initialLoad = hashSource ? resolveGitSource( hashSource ) : loadNewLocalGame();

bootSandbox( initialLoad );
if ( ! hashSource ) {

	openMenu( 'No play repo configured yet — enter one below to load your own game.' );
	els.menuRepoInput.focus();

}
