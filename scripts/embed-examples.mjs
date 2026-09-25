// ── embed-examples.mjs ───────────────────────────────────────────────────────
// Regenerates sandbox.html's EMBEDDED_EXAMPLES registry from every
// examples/<name>/ — no manifest file: each example is just one <basename>.glb
// and its matching <basename>.js entry (auto-resolved, same rule sandbox.html
// uses for a real #repo= game). Those two files stay the source of truth
// (also what a real `#repo=owner/repo&file=<basename>.glb` load would fetch);
// sandbox.html carries an embedded copy so the "no #repo= hash" default path
// (and #example=<name>) never needs a same-origin fetch either — see
// sandbox.html's <body> comment for why that matters. Run this after editing
// an example's entry .js or regenerating its .glb.
//
// Run with: node scripts/embed-examples.mjs

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname( fileURLToPath( import.meta.url ) );
const root = path.join( __dirname, '..' );
const examplesDir = path.join( root, 'examples' );
const sandboxPath = path.join( root, 'docs', 'sandbox.html' );

const names = readdirSync( examplesDir, { withFileTypes: true } )
	.filter( ( d ) => d.isDirectory() )
	.map( ( d ) => d.name );

const registry = {};
for ( const name of names ) {

	const dir = path.join( examplesDir, name );
	const glbFile = readdirSync( dir ).find( ( f ) => f.toLowerCase().endsWith( '.glb' ) );
	if ( ! glbFile ) continue; // not an example dir (e.g. stray files) — skip

	const jsFile = glbFile.replace( /\.glb$/i, '.js' );
	if ( ! existsSync( path.join( dir, jsFile ) ) ) throw new Error( `${ name }: found ${ glbFile } but no matching ${ jsFile }` );

	registry[ name ] = {
		gameJs: readFileSync( path.join( dir, jsFile ), 'utf8' ),
		sceneB64: readFileSync( path.join( dir, glbFile ) ).toString( 'base64' ),
	};

}

let html = readFileSync( sandboxPath, 'utf8' );

const re = /(\/\* EMBEDDED_EXAMPLES:START \*\/\s*const EMBEDDED_EXAMPLES = )(?:.*?)(;\s*\/\* EMBEDDED_EXAMPLES:END \*\/)/s;
if ( ! re.test( html ) ) throw new Error( 'embed-examples.mjs: EMBEDDED_EXAMPLES markers not found in sandbox.html' );

html = html.replace( re, ( _m, prefix, suffix ) => prefix + JSON.stringify( registry ) + suffix );

writeFileSync( sandboxPath, html );
console.log( `embedded ${ Object.keys( registry ).length } example(s) into sandbox.html: ${ Object.keys( registry ).join( ', ' ) }` );
