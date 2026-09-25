# strata-play

The hosted **player** for Strata games — loads a game repo by URL hash, runs it
sandboxed, and lets you fork it. This is not a games editor: authoring happens
in the agent + VS Code + the [Strata scene editor](../strata-editor); this repo
only turns a game repo (content + plain-JS logic) into a playable, forkable URL.

With a fixed stack (three.js + a raycaster + cannon-es *optional* + [3DOM](https://github.com/tejaswigowda/3dom)),
a game is just a repo addressed by `#repo=…` — the same resolver, git, and
covenants as strata-editor, aimed at play instead of authoring.

## Quick start

```bash
node server.js        # serves docs/ at http://127.0.0.1:5510
```

Everything the browser actually loads (`index.html`, `play.js`, `sandbox.html`,
`lib/`) lives under `docs/` — the same directory GitHub Pages' own "serve from
/docs" option expects, so pushing this repo and pointing Pages at `docs/` on
`main` needs no extra config. `examples/`, `scripts/`, `test/` etc. stay at the
repo root — dev-only, never fetched by a browser (see "Repo layout" below).

Works with **any** static file server pointed at `docs/` — Live Server/Live
Preview, `python -m http.server`, GitHub Pages, `npx serve`, this repo's own
`server.js`, whatever — no special CORS configuration needed. The sandbox
`<iframe>` has an opaque origin (that's the whole point — see "Security
architecture" below), which would normally mean even a fetch back to *this
same host* needs `Access-Control-Allow-Origin`; `sandbox.html` sidesteps that
entirely by inlining everything it needs (runtime + the bundled example's
assets) instead of fetching any of this repo's own files — see that file's
`<body>` comment. (A stray
`Uncaught SecurityError: Failed to read the 'sessionStorage' property`
sometimes logged from inside the sandbox frame is unrelated and harmless —
it's a content script some other tool/extension injected into the page, not
anything this app touches.)

Open `http://127.0.0.1:5510/` — with no URL hash it boots the bundled seed
example (`examples/hello/`) straight away, no GitHub repo required. To play a
game from a real repo:

```
http://127.0.0.1:5510/#repo=owner/repo&file=game.glb
```

## The URL scheme (identical to strata-editor)

```
#repo=<owner>/<repo>[@ref]&file=<name>.glb[&commit=<sha|tag>][&present=true]
```

- `repo` — `owner/repo`, optionally with an `@ref` (branch/tag/commit SHA).
- `file` — path to the game's scene **`.glb`** inside that repo. There is no
  manifest file; the entry module is auto-resolved as the same path with a
  `.js` extension (`file=levels/one.glb` → entry `levels/one.js`).
- `commit=` — wins over an `@ref` on `repo=` (accepts a branch, tag, or commit
  SHA — most-specific-wins; with neither given, tries `main` then `master`).
- `present=true` (or `preview=true`) — prefer jsDelivr first (scale over
  freshness); the default (`authoring`) tries `raw.githubusercontent.com`
  first, so a change just pushed to the game repo shows up on reload.

Reads (the scene GLB, the entry JS) resolve through the same CDN edges
strata-editor uses (`docs/lib/git-resolver.js`, vendored unchanged from that
repo) — never `api.github.com` in the load path. Only **forking** (a write)
uses the GitHub REST API, and only with a token you provide. A failed read
reports every ref actually tried (e.g. `"outputs/scene.js" not found on main
or master`) rather than just the last one, so a repo with only `main` never
reads as "it assumed master and gave up."

A `.glb` with no matching `.js` still loads — the entry is optional; a bare
scene falls back to a synthesized default (mouse-orbit view via three's
`OrbitControls`, never written back to the repo) instead of failing outright.
Add a real entry `.js` alongside the `.glb` whenever the scene needs to
actually be a *game*.

## The game-repo contract

A game repo is just **two files**: a scene `.glb`, and that scene's entry
module — **always the scene's own basename with a `.js` extension**
(`game.glb` → `game.js`), auto-resolved, never authored as a separate field.
There is no manifest: `physics` is auto-detected from whether the scene's own
labels ask for any (see [label → physics body vocabulary](#label--physics-body-vocabulary)
below) — a scene with none of those classes never pays for cannon-es. Runtime
versions are always the host's pinned defaults (see "Pinned runtime stack").

### The `init(ctx)` contract — the whole game API

The entry module (`game.js`, alongside `game.glb`) default-exports `init(ctx)`:

```js
export default function init( ctx ) {
  // ctx.THREE      the pinned three.js namespace
  // ctx.scene      the loaded scene (a THREE.Group, from the GLB)
  // ctx.$S         3DOM selector fn over the scene — ctx.$S('#door'), ctx.$S('.coin')
  // ctx.camera, ctx.renderer, ctx.canvas
  // ctx.world      a cannon-es World, or null if "physics" is false
  // ctx.input      { onPointer(fn), onKey(fn), pointerRay(), isDown(code), axis(neg,pos) }
  // ctx.pick(selector)        raycaster pick, wrapped as a $S set
  // ctx.bindBody / ctx.getBody   cannon-es <-> three sync for a labeled node
  // ctx.onFrame(fn)  fixed-timestep (1/60s) update — the runtime owns the loop
  // ctx.onReset(fn) / ctx.reset()   deterministic reset lifecycle
  // ctx.state      a plain object the game reads/writes
}
```

Interaction is plain JS written against this object — **no 3DOM extension**,
no framework. Picking uses `ctx.input.pointerRay()` + three's `Raycaster`
(`ray.intersectObjects($S('.coin').toArray())`), exactly as in
`examples/hello/game.js`.

## Security architecture (non-negotiable)

Two origins, one boundary:

- **Host shell** (`docs/index.html` + `docs/play.js`) — trusted. Parses the hash, does
  git reads + fork (a write), holds the GitHub token in its own
  `localStorage`, renders the sandbox `<iframe>`.
- **Sandbox** (`docs/sandbox.html`) — untrusted. Runs the pinned stack plus the
  game's own code, all inlined in this one file (no separate runtime.js — see
  "Repo layout" below). The `<iframe>` is created with
  `sandbox="allow-scripts"` and **without `allow-same-origin`**, so it gets an
  opaque origin: it cannot read the host's `localStorage` (where the token
  lives) and cannot reach `window.parent`'s DOM. The two talk only over
  `postMessage` — the host sends `{ source, file }` (repo coordinates + the
  scene `.glb` path, never bytes, never the token); the
  sandbox sends `strata:ready` / `strata:loaded` / `strata:error` /
  `strata:fork-requested` / `strata:save` (host validates path-scope + a size
  cap, then only ever acks — strata-play never commits during play; see
  `validateSaveRequest` in `play.js`). Any other message type is ignored —
  allowlist, not denylist.

The token never enters the iframe, so a shared game link cannot exfiltrate it.
`test/play.spec.mjs` verifies this directly: it sets a dummy value in the
host's `localStorage`, then confirms code evaluated inside the sandbox frame
gets a thrown/blocked access for both `localStorage` and `window.parent.document`.
`test/redteam.spec.mjs` goes further — it runs the bundled `#example=redteam`
hostile game and confirms all five of the security work order's red-team
attacks fail: reading the token, this frame's own storage, `window.parent`'s
DOM, a top-frame navigation, a direct `api.github.com` call (CSP-blocked, see
below), and a forged `strata:save` outside the game's own repo scope.

A Content-Security-Policy on `sandbox.html` adds defense-in-depth on top of
origin isolation: `connect-src` lists only the two CDN hosts `git-resolver.js`
ever talks to (jsDelivr, raw.githubusercontent.com) — not `api.github.com`, so
a malicious game's direct API call is refused at the network layer, not just
left tokenless.

## Pinned runtime stack (`sandbox.html`)

An import map pins exact versions — never `@latest` — for `three`, `cannon-es`,
and `@tejaswigowda/3dom`. `cannon-es` is always mapped but only actually
**imported** when the loaded scene's own labels ask for physics (auto-detected
— see below); a non-physics game never pays for it. There is no per-game
version override — every game runs on the same host-pinned stack, always.

## Game harness (`ctx`, inside `sandbox.html`)

Beyond the [`init(ctx)` contract](#the-initctx-contract--the-whole-game-api)
above, `ctx` carries the small, shared harness every game is written against
(never grown per-game, never merged into 3DOM):

| | |
|---|---|
| `ctx.onFrame(fn)` | Runs at a **fixed timestep** (1/60s), decoupled from the render rate via a real accumulator — same inputs give the same result on a given pinned build, so Playwright runs are repeatable. Rendering still happens once per `requestAnimationFrame`. |
| `ctx.input.axis(negCodes, posCodes)` / `.isDown(code)` | Named, device-adaptive input: held keys, falling back to a pointer/touch vertical drag when no bound key is held. `.onPointer`/`.onKey`/`.pointerRay()` remain for anything bespoke. |
| `ctx.pick(selector)` | Raycaster helper: pointer → labeled pick, already wrapped as a `$S` set (`ctx.pick('.coin').setVisible(false)`). |
| `ctx.bindBody(selectorOrObject, body)` / `ctx.getBody(...)` | cannon-es ↔ three sync: register (or look up) the body driving a labeled object; a `.dynamic` body's transform is copied onto its object every fixed step. |
| `ctx.onReset(fn)` / `ctx.reset()` | Deterministic reset lifecycle — a game registers what "restart" means (score, ball position, …); the host or the game itself can trigger it. |

### Label → physics body vocabulary

Physics is never flagged manually — `sandbox.html` auto-generates cannon-es
bodies whenever the loaded scene's own labels ask for any at all. Colliders
are never baked into the GLB, so the same labeled asset becomes a physics
scene here and (by the same convention) in a Unity handoff:

| Class | Body |
|---|---|
| `.static` | Static body (mass 0) — walls, floors, court. |
| `.dynamic` | Rigidbody (mass 1); synced body → object every fixed step. Add `ccd: true` to a node's glTF `extras` for the tunneling guard (fast/small bodies, e.g. a ball) — cannon-es's CCD is weaker than a native engine's; that ceiling is real, not hidden. |
| `.kinematic` | Kinematic body, script/input-driven — synced object → body every fixed step (the game moves the object directly; physics sees it and collides other bodies against it correctly). |
| `.trigger` | Sensor only, no collision response — a game reads overlap itself off `node.userData.physicsBody`. |

Shape defaults to a box fit to the node's bounds; a glTF `extras.collider:
"sphere"` hint overrides that. **No label → no body** (render-only) — physics
is never inferred silently. Labels are authored as glTF node `extras`
(`{"classes":["dynamic"],"collider":"sphere","ccd":true}`), which three.js's
`GLTFLoader` flattens onto `userData` — `applyExtrasAsClasses()` promotes
`userData.classes` to 3DOM's `customClasses` *before* `autoLabel` runs (which
would otherwise overwrite `userData.classes` with its own auto-derived set).

## Repo layout

```
docs/index.html              host shell (trusted): hash parse, chrome, hosts the sandbox iframe
docs/play.js                  host-side controller: hash/menu load, wire the sandbox, fork, save-validation
docs/sandbox.html             the UNTRUSTED frame: CSP, pinned importmap, inlined harness + game boot
docs/lib/git-resolver.js      vendored, unchanged, from strata-editor — the CDN resolver (host-side)
docs/lib/git-host.js          host-only: token storage, parseRepo, fork (adapted from strata-editor)
server.js                    dev static server — serves docs/ as its web root
examples/hello/             seed example — 3 coins + a door, the smoke test (game.glb + game.js)
examples/pong/              work order §7 — labels-driven physics, input, AI, score/reset
examples/redteam/           work order §1.5 — the five sandbox attacks, all expected to fail
scripts/embed-examples.mjs  regenerates docs/sandbox.html's embedded copy of every example's game.glb/game.js
test/play.spec.mjs          Playwright: hello example — selectors/state, and the security proof
test/redteam.spec.mjs       Playwright: §1.5 red-team acceptance (all five attacks fail)
test/pong.spec.mjs          Playwright: §7 Pong acceptance (criteria 1-5; see honesty ledger below)
```

Everything under `docs/` is what a browser fetches; `examples/`, `scripts/`,
`test/` and `server.js` are dev-only and never served to a game.

Each example directory is just `game.glb` + `game.js` (plus a `build-scene.mjs`
generator for the `.glb` — not fetched at runtime, purely a dev-time tool).
There is no separate `runtime.js` file either: everything that runs inside the
sandbox lives inline in `sandbox.html` (including a small, deliberately
duplicated copy of `git-resolver.js`'s `resolveAssetBytes`) so that document
never performs a same-origin fetch — see its `<body>` comment for why. Only
`play.js` (the trusted host, never opaque-origin) imports `docs/lib/git-resolver.js`
normally.

## Minimal play UI

Chrome-light, by design: fullscreen, restart, a title, an "Open source" link,
and a **Fork** button (clones the current repo to your account via the GitHub
API — needs a token, entered once and kept only in the host's own
`localStorage` — then reloads the shell against the fork). Nothing else: no
visual trigger-wiring, no code editor. Authoring stays in the agent + VS Code
+ the Strata scene editor.

The **Menu** button (top-left) opens the one place all git controls live:
"New" / "Examples" (disabled for now), a **Load from repo** form
(`repo` / `commit` / `file` / `present`, building the exact `#repo=…` hash
above and reloading), and the **GitHub token** field Fork also opens
automatically the first time it needs one. Opening the menu while a `#repo=`
game is loaded pre-fills the load form from what's currently playing.

## Dev / verify loop

```bash
npm install
npx playwright install chromium   # first run only
npm test
```

`test/play.spec.mjs` is the agent's own dev loop — it is never shipped as part
of a game, the same way strata-editor's eval matrix isn't part of an authored
scene. After editing an example's `game.js` or regenerating its `game.glb`,
run `node scripts/embed-examples.mjs` to refresh `sandbox.html`'s embedded
copy (`examples/*/build-scene.mjs` regenerates a `game.glb` itself).

## Honesty ledger

Per the strata-games work order's own discipline ("implemented ≠ verified"):

**Done, verified by an automated test:**
- §1 origin isolation + §1.5 red-team (all five attacks fail) — `test/redteam.spec.mjs`.
- §1.3 save-protocol validation (path-scope + size cap, allowlisted types) — exercised by the red-team's forged-save attempt.
- §1.4 CSP (`connect-src` excludes `api.github.com`) — exercised by the red-team's direct-API attempt.
- §3 harness (fixed-timestep `onFrame`, input axis/isDown, `pick()`, `bindBody`/`getBody`, reset lifecycle) — exercised by both `examples/hello` and `examples/pong`.
- §4 label → physics body vocabulary — exercised by Pong (`.static`/`.kinematic`/`.dynamic`).
- §5 fixed timestep + CCD wiring — exercised by Pong (`extras.ccd` on the ball); determinism holds across the repeated local runs in this dev loop.
- §6 deploy contract (CDN-resolved, importmap-pinned, `#repo=` hash scheme) — `test/play.spec.mjs`, and manually via `#example=`.
- §7 Pong acceptance criteria 1 (bundled-route load only — see below), 2, 3, 4, 5 — `test/pong.spec.mjs`.
- No same-origin fetch from the sandbox on any static host — verified against `python -m http.server` (no CORS headers at all) with zero console errors.
- Default-camera framing is scale-correct for any real-world scene, not just this repo's own hand-built examples — a real-world glTF (`tejaswigowda/test1`, a room-scale kitchen scene) initially rendered as a flat, featureless gray fill until the user dragged the mouse. Root cause (confirmed via a raycast from the camera, not a compositor/rendering bug): the default camera pose was a fixed, hardcoded position/lookAt tuned for this repo's own small, hand-built scenes, so on a much larger scene it ended up 0.4 units from a wall, filling the whole frame with one point-blank polygon face. Dragging only "fixed" it by accident (OrbitControls rotation moved the camera off that wall). Fixed by framing the camera (and the default orbit-view fallback's target) from the loaded scene's own `THREE.Box3` bounds instead of a magic-number pose — verified via the same real repo, screenshotted with zero interaction.

**Expected, not yet verified** (be precise about the gap, not silent about it):
- §7 acceptance criterion 1's literal form — loading Pong from a real, pushed `#repo=owner/repo&file=game.glb` URL. This repo hasn't been pushed to GitHub yet in this dev loop, so that exact path is untested here; `test/pong.spec.mjs` exercises the identical scene/entry/harness code via the bundled `#example=pong` route instead (the only difference is which resolver branch supplies the bytes — CDN vs. embedded).
- §7 acceptance criterion 6 ("the §1.5 red-team checklist passes for this game's sandbox") is verified once, generically, against the shared sandbox boundary rather than re-run per game — the isolation mechanism is identical for every game, so a per-game re-run would add no new coverage.
- §2's "editor's live-preview MUST run inside the same sandbox as the player" — that's strata-editor's own preview path, out of this repo's scope; not implemented or verified here.
- The Unity handoff half of §7 (glTFast import, labels → colliders, Y-up flip) — out of this repo's scope entirely (web path only).
- Touch/drag input for a *horizontal*-axis game (Pong uses keyboard only in practice) — `input.axis()`'s pointer-drag fallback is wired for a *vertical* drag; a horizontal-axis game would need a small follow-up, not yet built or tested.