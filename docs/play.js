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

// A host-wide preference, not per-game — persists across reloads/restarts/forks
// the same way the git token does, and is pushed into every sandboxed game via
// postMessage (the sandbox has no localStorage of its own to read it from).
let muted = localStorage.getItem( 'strata-play-muted' ) === '1';

function updateMuteButton() {

	els.muteBtn.title = muted ? 'Unmute' : 'Mute';
	els.muteBtn.setAttribute( 'aria-label', els.muteBtn.title );
	els.muteBtn.innerHTML = `<i class="fa-solid ${ muted ? 'fa-volume-xmark' : 'fa-volume-high' }"></i>`;

}

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
	muteBtn: document.getElementById( 'mute-btn' ),
	openSourceLink: document.getElementById( 'open-source-link' ),
	menuBtn: document.getElementById( 'menu-btn' ),
	menuOverlay: document.getElementById( 'menu-overlay' ),
	menuCloseBtn: document.getElementById( 'menu-close-btn' ),
	menuTabBtns: Array.from( document.querySelectorAll( '#menu-tabs button' ) ),
	menuTabPanels: Array.from( document.querySelectorAll( '.tab-panel' ) ),
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
	menuCommitMessageField: document.getElementById( 'menu-commit-message-field' ),
	menuCommitBtn: document.getElementById( 'menu-commit-btn' ),
	menuCommitPathInput: document.getElementById( 'menu-commit-path' ),
	menuCommitMessageInput: document.getElementById( 'menu-commit-message' ),
	menuCodeEmpty: document.getElementById( 'menu-code-empty' ),
	menuCodeStatus: document.getElementById( 'menu-code-status' ),
	menuCodeEditor: document.getElementById( 'menu-code-editor' ),
	menuCodeTextarea: document.getElementById( 'menu-code-textarea' ),
	menuCodeActions: document.getElementById( 'menu-code-actions' ),
	menuCodeFindBtn: document.getElementById( 'menu-code-find-btn' ),
	menuCodeReplaceBtn: document.getElementById( 'menu-code-replace-btn' ),
	menuCodeCancelBtn: document.getElementById( 'menu-code-cancel-btn' ),
	menuCodeSaveBtn: document.getElementById( 'menu-code-save-btn' ),
	menuSettingsEmpty: document.getElementById( 'menu-settings-empty' ),
	menuSettingsList: document.getElementById( 'menu-settings-list' ),
	watchdogOverlay: document.getElementById( 'watchdog-overlay' ),
	watchdogWaitBtn: document.getElementById( 'watchdog-wait-btn' ),
	watchdogStopBtn: document.getElementById( 'watchdog-stop-btn' ),
	inputProvider: document.getElementById( 'input-provider' ),
};

let current = null; // { source, dir, file, title, entryOverride }
let pendingForkAfterToken = false; // set when Fork opened the menu to collect a missing token

// ── Settings (work order §3) ────────────────────────────────────────────────────────
// Declaration lives in the game's own `config.settings` export (sandbox-side);
// the host only ever renders UI from that schema and stores the player's own
// choices — per-player, local, NEVER written to the repo. Keyed per game so
// two different games (or the same game loaded from two different repos)
// never collide.
function settingsStorageKey( loaded ) {

	const { source, file } = loaded;
	return source.kind === 'git'
		? `strata-play-settings:${ source.owner }/${ source.repo }/${ file }`
		: `strata-play-settings:local:${ source.example }/${ file }`;

}

function resolveSettingsValues( schema, key ) {

	let saved = {};
	try { saved = JSON.parse( localStorage.getItem( key ) || '{}' ); } catch { saved = {}; }

	const values = {};
	for ( const setting of schema ) values[ setting.key ] = ( setting.key in saved ) ? saved[ setting.key ] : setting.default;
	return values;

}

function renderSettingsPanel( schema, key, values ) {

	els.menuSettingsList.innerHTML = '';
	els.menuSettingsEmpty.hidden = schema.length > 0;

	for ( const setting of schema ) {

		const row = document.createElement( 'div' );
		row.className = 'setting-row';

		const label = document.createElement( 'label' );
		label.textContent = setting.label || setting.key;
		row.appendChild( label );

		const commit = ( value ) => {

			values[ setting.key ] = value;
			localStorage.setItem( key, JSON.stringify( values ) );
			els.iframe.contentWindow?.postMessage( { type: 'strata:setting', key: setting.key, value }, '*' );

		};

		if ( setting.type === 'enum' ) {

			const select = document.createElement( 'select' );
			for ( const v of setting.values || [] ) {

				const opt = document.createElement( 'option' );
				opt.value = v;
				opt.textContent = v;
				opt.selected = v === values[ setting.key ];
				select.appendChild( opt );

			}
			select.addEventListener( 'change', () => commit( select.value ) );
			row.appendChild( select );

		} else if ( setting.type === 'bool' ) {

			const check = document.createElement( 'label' );
			check.className = 'check';
			const input = document.createElement( 'input' );
			input.type = 'checkbox';
			input.checked = !! values[ setting.key ];
			input.addEventListener( 'change', () => commit( input.checked ) );
			check.appendChild( input );
			check.appendChild( document.createTextNode( setting.label || setting.key ) );
			row.innerHTML = ''; // bool's own label doubles as the row label — drop the generic one above
			row.appendChild( check );

		} else if ( setting.type === 'range' ) {

			const wrap = document.createElement( 'div' );
			wrap.className = 'range-row';
			const input = document.createElement( 'input' );
			input.type = 'range';
			input.min = setting.min ?? 0;
			input.max = setting.max ?? 100;
			input.step = setting.step ?? 1;
			input.value = values[ setting.key ];
			const out = document.createElement( 'output' );
			out.textContent = values[ setting.key ];
			input.addEventListener( 'input', () => { out.textContent = input.value; } );
			input.addEventListener( 'change', () => commit( Number( input.value ) ) );
			wrap.appendChild( input );
			wrap.appendChild( out );
			row.appendChild( wrap );

		}

		els.menuSettingsList.appendChild( row );

	}

}

// ── Hash parsing ───────────────────────────────────────────────────────────
// #repo=<owner>/<repo>[@ref]&file=<path>[&branch=<branch>][&commit=<sha|tag>]
// [&logic=<path>.js][&present=true|preview=true] — identical param
// names/precedence to strata-editor's loadSceneFromHash (Menubar.Git.js) for
// repo/file/branch/commit/present; &logic= is this project's own addition
// (work order §1) — an explicit override for which logic module drives the
// loaded scene, winning over the scene's own `extras["strata:logic"]`, which
// in turn wins over the basename default. identical param names/precedence to
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
		logic: params.get( 'logic' ) || null,
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
		logic: hashSource.logic || null,
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

// ── Resource watchdog (work order §4.2) ───────────────────────────────────────
// The sandbox's origin isolation stops a game reaching anything it shouldn't
// (§4.1's CSP, the iframe boundary) — it does nothing about a game wedging
// its OWN thread (a hung loop, a runaway spawn, a mining script). The sandbox
// posts a 'strata:heartbeat' every frame from inside its own render loop
// (sandbox.html); if one hasn't arrived in WATCHDOG_TIMEOUT_MS, the game's
// thread is presumed blocked and this surfaces an exit the player otherwise
// wouldn't have — this can't force the browser to reclaim CPU/GPU (no API
// does, from a page), it just gives a stuck game a "stop it" instead of a
// tab that's silently gone unresponsive forever.
const WATCHDOG_TIMEOUT_MS = 5000;
const WATCHDOG_CHECK_INTERVAL_MS = 1000;

let lastHeartbeatAt = 0;
let watchdogArmed = false; // false during the brief load window before a game's first-ever heartbeat — never flags normal loading as "hung"
let watchdogTripped = false;

function armWatchdog() {

	lastHeartbeatAt = Date.now();
	watchdogArmed = true;
	// Deliberately does NOT auto-hide an already-tripped prompt — a game that
	// demonstrably stalled recovering on its own right as the player reads
	// this shouldn't silently erase that it happened; only an explicit Keep
	// waiting/Stop (or a genuinely NEW game loading, via disarmWatchdog)
	// clears it.

}

function disarmWatchdog() {

	watchdogArmed = false;
	hideWatchdogPrompt();

}

function showWatchdogPrompt() {

	if ( watchdogTripped ) return;
	watchdogTripped = true;
	els.watchdogOverlay.hidden = false;

}

function hideWatchdogPrompt() {

	watchdogTripped = false;
	els.watchdogOverlay.hidden = true;

}

setInterval( () => {

	if ( ! watchdogArmed ) return;
	if ( Date.now() - lastHeartbeatAt > WATCHDOG_TIMEOUT_MS ) showWatchdogPrompt();

}, WATCHDOG_CHECK_INTERVAL_MS );

els.watchdogWaitBtn.addEventListener( 'click', () => {

	// Not a real fix (the thread is still however blocked it was) — just
	// gives it more rope before asking again, for a game that's merely slow
	// (a big one-time asset decode, say) rather than genuinely hung.
	lastHeartbeatAt = Date.now();
	hideWatchdogPrompt();

} );

els.watchdogStopBtn.addEventListener( 'click', () => {

	disarmWatchdog();
	if ( els.iframe._strataCleanup ) els.iframe._strataCleanup();
	els.iframe.src = 'about:blank';
	hideOverlay();
	setStatus( 'Game stopped — it stopped responding.' );

} );

// ── Input providers (work order §2) — posecaster is a SIBLING frame at its
// own origin, never inside the game sandbox: camera pixels stay at that
// origin, this host only ever relays landmark NUMBERS into the sandbox as
// ordinary strata:input data. posecaster hosts 5 models at one origin,
// selected via its own `#model=<name>` hash — `requires:['input:X']` in a
// game asks for whichever one it needs. Set POSE_PROVIDER_ORIGIN to null/''
// to disable every provider on this host (a game declaring `requires` on any
// of them then shows the same clear "unavailable" message as a missing
// label).
const POSE_PROVIDER_ORIGIN = 'https://posecaster.com';
const VALID_PROVIDERS = [ 'pose', 'hands', 'face', 'facemesh', 'holistic' ]; // == posecaster's own model names, 1:1
const AVAILABLE_PROVIDERS = POSE_PROVIDER_ORIGIN ? VALID_PROVIDERS : [];

const MAX_LANDMARKS_PER_GROUP = 256; // generous vs. any real pose/hand/face topology — just a sanity cap, never a silent truncation in normal use

function isValidLandmarkArray( arr ) {

	if ( ! Array.isArray( arr ) || arr.length > MAX_LANDMARKS_PER_GROUP ) return false;
	return arr.every( ( lm ) => lm && typeof lm === 'object'
		&& typeof lm.name === 'string'
		&& typeof lm.x === 'number' && typeof lm.y === 'number' && typeof lm.z === 'number'
		&& typeof lm.score === 'number' );

}

// Shape-validate before relaying anything into the sandbox — numbers only,
// bounded array lengths, nothing resembling a blob/image ever passed through
// (posecaster's own out=postmessage mode never sends one, but the host never
// just trusts that from across an origin boundary either).
function isValidLandmarkFrame( frame ) {

	if ( ! frame || typeof frame !== 'object' || typeof frame.t !== 'number' ) return false;
	if ( ! isValidLandmarkArray( frame.pose ) ) return false;
	if ( frame.hands !== undefined ) {

		if ( ! frame.hands || typeof frame.hands !== 'object' ) return false;
		if ( frame.hands.left !== undefined && ! isValidLandmarkArray( frame.hands.left ) ) return false;
		if ( frame.hands.right !== undefined && ! isValidLandmarkArray( frame.hands.right ) ) return false;

	}
	if ( frame.face !== undefined && ! isValidLandmarkArray( frame.face ) ) return false;
	return true;

}

let activeProvider = null; // one of VALID_PROVIDERS, or null
let onProviderMessage = null;

// Lazy: no src, no camera permission, no indicator — until a loaded game
// actually asks (via the sandbox's own `strata:activate-provider`, sent only
// once its `requires` validation confirms it wants 'input:<provider>').
function activateProvider( provider ) {

	if ( ! POSE_PROVIDER_ORIGIN || ! VALID_PROVIDERS.includes( provider ) || activeProvider ) return;
	activeProvider = provider;

	const target = encodeURIComponent( window.location.origin );
	els.inputProvider.src = `${ POSE_PROVIDER_ORIGIN }/#model=${ provider }&embed=true&out=postmessage&target=${ target }`;
	els.inputProvider.hidden = false;

	onProviderMessage = ( event ) => {

		// posecaster's own top-level #model= routing (added upstream after
		// this was first written) wraps the actual model page in ANOTHER
		// iframe of its own — the real sender's `.source` is that innermost
		// frame, a DIRECT CHILD of the one we embedded, not the embedded
		// frame itself. `.parent` is one of the handful of properties the
		// HTML spec allows reading cross-origin, so this still only accepts
		// a message whose sender is (one level under) our OWN provider
		// iframe — shape/origin alone is never trusted across an origin
		// boundary either way (work order §4#3).
		if ( event.source?.parent !== els.inputProvider.contentWindow || event.origin !== POSE_PROVIDER_ORIGIN ) return;
		const msg = event.data;
		if ( ! msg || msg.type !== 'posecaster:landmarks' || ! isValidLandmarkFrame( msg.frame ) ) return;

		els.iframe.contentWindow?.postMessage( { type: 'strata:input', provider: activeProvider, channel: 'default', data: msg.frame }, '*' );

	};
	window.addEventListener( 'message', onProviderMessage );

}

// Torn down on every new game load (bootSandbox) so a game that doesn't ask
// for an input provider never keeps a camera stream running from whatever
// game loaded before it.
function deactivateProvider() {

	if ( ! activeProvider ) return;
	activeProvider = null;
	if ( onProviderMessage ) { window.removeEventListener( 'message', onProviderMessage ); onProviderMessage = null; }
	els.inputProvider.src = '';
	els.inputProvider.hidden = true;

}

// ── Sandbox lifecycle (postMessage handshake) ────────────────────────────────
// The sandbox posts 'strata:ready' the instant its own listener is attached
// (before it does any loading), so the host never races a postMessage against
// a listener that isn't there yet.

function bootSandbox( loaded ) {

	current = loaded;
	disarmWatchdog(); // re-armed on this game's own first heartbeat, not the previous game's leftover timestamp
	deactivateProvider(); // re-activated only if THIS game's own requires check asks for it
	updateChromeFor( loaded );
	showOverlay( 'Loading game…' );
	renderSettingsPanel( [], null, {} ); // clear the PREVIOUS game's Settings tab immediately — its own schema (if any) arrives once loadGame() gets far enough

	const onMessage = ( event ) => {

		if ( event.source !== els.iframe.contentWindow ) return; // only ever our own sandbox
		const msg = event.data;
		if ( ! msg || typeof msg !== 'object' ) return;

		if ( msg.type === 'strata:heartbeat' ) {

			armWatchdog();

		} else if ( msg.type === 'strata:ready' ) {

			els.iframe.contentWindow.postMessage( {
				type: 'strata:init',
				source: loaded.source,
				file: loaded.file,
				logic: loaded.logic, // &logic= override (work order §1); undefined for a bundled local example or a basename-paired repo load
				entryOverride: loaded.entryOverride, // set by the menu's Code-tab Save action; undefined otherwise (fetch as normal)
				providers: AVAILABLE_PROVIDERS, // which input providers THIS host has configured — the sandbox validates a game's `requires:['input:X']` against this
				muted,
			}, '*' );

		} else if ( msg.type === 'strata:activate-provider' ) {

			// The sandbox only ever sends this once its own requires validation
			// confirms the loaded game actually wants this provider — never
			// eager, never for a game that doesn't ask.
			activateProvider( msg.provider );

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

		} else if ( msg.type === 'strata:settings-schema' ) {

			// §3: the sandbox only ever declares a schema; THIS host renders the
			// actual Settings-tab UI and owns persistence (localStorage, keyed
			// per game — never the repo). Replies right away so the sandbox can
			// resolve ctx.settings before calling the game's own init(ctx).
			const schema = Array.isArray( msg.settings ) ? msg.settings : [];
			const key = settingsStorageKey( loaded );
			const values = resolveSettingsValues( schema, key );
			renderSettingsPanel( schema, key, values );
			els.iframe.contentWindow.postMessage( { type: 'strata:settings-values', values }, '*' );

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

// §1 lifecycle: the Code tab's Save action posts a fresh strata:init straight
// to the ALREADY-RUNNING sandbox document instead of reloading the iframe
// (restart() above) — the sandbox's own loadGame() re-fetches/rebuilds just
// the game half (scene, ctx, init(ctx)) in place, never a second renderer/
// canvas/audio-context/click-to-play-gate. The existing onMessage listener
// (still attached — the iframe never navigated) handles the strata:loaded/
// strata:error reply exactly like a normal load.
function hotReloadGame() {

	if ( ! current ) return;
	hideWatchdogPrompt(); // the next heartbeat re-confirms liveness; no need to wait out the full timeout again
	showOverlay( 'Reloading…' );
	els.iframe.contentWindow?.postMessage( {
		type: 'strata:init',
		source: current.source,
		file: current.file,
		logic: current.logic,
		entryOverride: current.entryOverride,
		providers: AVAILABLE_PROVIDERS,
		muted,
	}, '*' );

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

	populateCodeAndCommitSection();

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

// ── Code + Commit ─────────────────────────────────────────────────────────────
// The Code tab's editor is the single source of truth for "what should this
// game's entry module contain" — Save (hot-)reloads the SANDBOXED game from
// its current text (never committed by that alone); Commit is a fully
// separate, explicit action that pushes that same text to GitHub. Neither one
// is the sandbox's own `strata:save` postMessage path below, which this file
// still only ever acks and never acts on (see validateSaveRequest) — a game's
// own code still cannot get anything committed; only a person at this menu,
// with their own token, can.

let codeMirror = null;
let lastSyncedSource = null; // what the RUNNING game currently reflects (null until a repo is loaded)
let codeEntryLoaded = false; // avoid re-fetching the entry's content every time the menu re-opens

function ensureCodeMirror() {

	if ( codeMirror ) return codeMirror;

	codeMirror = CodeMirror.fromTextArea( els.menuCodeTextarea, {
		mode: 'javascript',
		theme: 'dracula',
		lineNumbers: true,
		matchBrackets: true,
		indentUnit: 2,
		tabSize: 2,
	} );

	codeMirror.on( 'change', updateCodeStatus );

	return codeMirror;

}

function updateCodeStatus() {

	if ( lastSyncedSource === null ) { els.menuCodeStatus.hidden = true; return; }

	const dirty = codeMirror.getValue() !== lastSyncedSource;
	els.menuCodeStatus.hidden = false;
	els.menuCodeStatus.textContent = dirty
		? 'Unsaved changes — Save to sync with the running game'
		: 'Synced with the running game';
	els.menuCodeStatus.classList.toggle( 'dirty', dirty );
	els.menuCodeStatus.classList.toggle( 'synced', ! dirty );

}

async function populateCodeAndCommitSection() {

	const isGit = !! ( current && current.source.kind === 'git' );
	els.menuCommitHeading.hidden = ! isGit;
	els.menuCommitHint.hidden = ! isGit;
	els.menuCommitPathField.hidden = ! isGit;
	els.menuCommitMessageField.hidden = ! isGit;
	els.menuCommitBtn.hidden = ! isGit;
	els.menuCodeEmpty.hidden = isGit;
	els.menuCodeEditor.hidden = ! isGit;
	els.menuCodeActions.hidden = ! isGit;

	if ( ! isGit ) return;

	const { owner, repo, ref, mode } = current.source;
	const branch = ref || 'main'; // best-effort — see git-host.js's commitFile comment
	els.menuCommitTarget.textContent = `${ owner }/${ repo }@${ branch }`;

	if ( codeEntryLoaded ) return; // don't clobber in-progress edits on a later menu re-open
	codeEntryLoaded = true;

	const entryPath = current.file.replace( /\.glb$/i, '.js' );
	els.menuCommitPathInput.value = entryPath;
	els.menuCommitMessageInput.value = `Update ${ entryPath }`;

	let source;
	try {

		const bytes = await resolveAssetBytes( { owner, repo, ref, path: entryPath, mode } );
		source = new TextDecoder( 'utf-8' ).decode( bytes );

	} catch {

		source = ''; // no entry module yet — a blank start is fine, this is a text editor, not a diff tool

	}

	ensureCodeMirror().setValue( current.entryOverride ?? source );
	lastSyncedSource = current.entryOverride ?? source;
	updateCodeStatus();

}

function saveCode() {

	if ( ! codeMirror ) return;
	current.entryOverride = codeMirror.getValue();
	lastSyncedSource = current.entryOverride;
	updateCodeStatus();
	hotReloadGame();

}

function cancelCode() {

	if ( ! codeMirror || lastSyncedSource === null ) return;
	codeMirror.setValue( lastSyncedSource );
	updateCodeStatus();

}

async function commitChanges() {

	if ( ! current || current.source.kind !== 'git' || ! codeMirror ) return;

	const token = tokenOrPrompt();
	if ( ! token ) return; // menu now open on the token field; user retries after saving

	const path = els.menuCommitPathInput.value.trim();
	const content = codeMirror.getValue();
	const message = els.menuCommitMessageInput.value.trim() || `Update ${ path }`;
	if ( ! path ) { els.menuCommitPathInput.focus(); return; }

	const { owner, repo, ref } = current.source;
	const branch = ref || 'main';
	setStatus( `Committing ${ path } to ${ owner }/${ repo }@${ branch }…` );

	try {

		await commitFile( owner, repo, path, content, message, branch, token );
		setStatus( `✓ Committed ${ path } to ${ owner }/${ repo }@${ branch }` );

	} catch ( err ) {

		setStatus( `Commit failed: ${ err.message }` );

	}

}

// ── Tabs ───────────────────────────────────────────────────────────────────────

function switchTab( name ) {

	for ( const btn of els.menuTabBtns ) btn.classList.toggle( 'active', btn.dataset.tab === name );
	for ( const panel of els.menuTabPanels ) panel.hidden = panel.dataset.tabPanel !== name;

	if ( name === 'code' && codeMirror ) codeMirror.refresh(); // was sized while hidden (0×0) — fix it up now that it's visible

}

for ( const btn of els.menuTabBtns ) btn.addEventListener( 'click', () => switchTab( btn.dataset.tab ) );

// ── Wire up chrome ────────────────────────────────────────────────────────────

els.restartBtn.addEventListener( 'click', restart );

els.fullscreenBtn.addEventListener( 'click', () => {

	const el = els.iframe.closest( '.stage' ) || els.iframe;
	if ( document.fullscreenElement ) document.exitFullscreen();
	else el.requestFullscreen().catch( () => {} );

} );

els.forkBtn.addEventListener( 'click', forkAndReload );

updateMuteButton();
els.muteBtn.addEventListener( 'click', () => {

	muted = ! muted;
	localStorage.setItem( 'strata-play-muted', muted ? '1' : '0' );
	updateMuteButton();
	els.iframe.contentWindow?.postMessage( { type: 'strata:mute', muted }, '*' );

} );

els.menuLoadBtn.addEventListener( 'click', loadFromMenu );

els.menuTokenSaveBtn.addEventListener( 'click', () => {

	const pat = els.menuTokenInput.value.trim();
	if ( ! pat ) return;
	saveSettings( { ...loadSettings(), pat } );
	els.menuTokenInput.value = '';

	if ( pendingForkAfterToken ) { pendingForkAfterToken = false; forkAndReload(); }

} );

els.menuCommitBtn.addEventListener( 'click', commitChanges );
els.menuCodeSaveBtn.addEventListener( 'click', saveCode );
els.menuCodeCancelBtn.addEventListener( 'click', cancelCode );
els.menuCodeFindBtn.addEventListener( 'click', () => ensureCodeMirror().execCommand( 'find' ) );
els.menuCodeReplaceBtn.addEventListener( 'click', () => ensureCodeMirror().execCommand( 'replace' ) );

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
