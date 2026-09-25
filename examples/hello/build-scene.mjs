// ── build-scene.mjs ──────────────────────────────────────────────────────────
// Regenerates game.glb for the "hello" seed example. No dependencies — hand-
// builds a minimal, valid glTF 2.0 binary (GLB) container: one shared unit-cube
// mesh (positions + face normals), two materials, and four nodes named
// "Coin 1"/"Coin 2"/"Coin 3"/"Door". Those names are what 3DOM's autoLabel
// turns into the selectors the game (and the Playwright test) address:
//   - a trailing " N" is stripped and the stem becomes a class, so the three
//     "Coin *" nodes all resolve as `.coin` (see 3dom/src/classDerive.js's
//     nameStemClass).
//   - `#door` matches a node's plain .name when no explicit label is set (see
//     3dom/src/selectorEngine.js's id matcher), so "Door" resolves `#door`.
//
// Run with: node build-scene.mjs   (writes ./game.glb)

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname( fileURLToPath( import.meta.url ) );

// ── Unit cube geometry (non-indexed, 36 vertices: 6 faces x 2 tris x 3) ──────
const positions = [];
const normals = [];

function face( a, b, c, d, n ) {

	for ( const p of [ a, b, c, a, c, d ] ) { positions.push( ...p ); normals.push( ...n ); }

}

const s = 0.5;
face( [ -s, -s,  s ], [  s, -s,  s ], [  s,  s,  s ], [ -s,  s,  s ], [  0,  0,  1 ] ); // +Z
face( [  s, -s, -s ], [ -s, -s, -s ], [ -s,  s, -s ], [  s,  s, -s ], [  0,  0, -1 ] ); // -Z
face( [ -s, -s, -s ], [ -s, -s,  s ], [ -s,  s,  s ], [ -s,  s, -s ], [ -1,  0,  0 ] ); // -X
face( [  s, -s,  s ], [  s, -s, -s ], [  s,  s, -s ], [  s,  s,  s ], [  1,  0,  0 ] ); // +X
face( [ -s,  s,  s ], [  s,  s,  s ], [  s,  s, -s ], [ -s,  s, -s ], [  0,  1,  0 ] ); // +Y
face( [ -s, -s, -s ], [  s, -s, -s ], [  s, -s,  s ], [ -s, -s,  s ], [  0, -1,  0 ] ); // -Y

const posArray = new Float32Array( positions );
const normArray = new Float32Array( normals );

function minMax3( arr ) {

	const min = [ Infinity, Infinity, Infinity ];
	const max = [ - Infinity, - Infinity, - Infinity ];
	for ( let i = 0; i < arr.length; i += 3 ) {

		for ( let k = 0; k < 3; k ++ ) {

			min[ k ] = Math.min( min[ k ], arr[ i + k ] );
			max[ k ] = Math.max( max[ k ], arr[ i + k ] );

		}

	}

	return { min, max };

}

const posBounds = minMax3( posArray );

// ── Binary chunk: positions then normals, 4-byte aligned throughout ─────────
const posBytes = Buffer.from( posArray.buffer );
const normBytes = Buffer.from( normArray.buffer );
const bin = Buffer.concat( [ posBytes, normBytes ] );

const vertexCount = posArray.length / 3;

const gltf = {
	asset: { version: '2.0', generator: 'strata-play build-scene.mjs' },
	scene: 0,
	scenes: [ { nodes: [ 0, 1, 2, 3 ] } ],
	nodes: [
		{ name: 'Coin 1', mesh: 0, translation: [ -1.4, 0.5, 0 ], scale: [ 0.35, 0.35, 0.35 ] },
		{ name: 'Coin 2', mesh: 0, translation: [ 0, 0.5, 0 ], scale: [ 0.35, 0.35, 0.35 ] },
		{ name: 'Coin 3', mesh: 0, translation: [ 1.4, 0.5, 0 ], scale: [ 0.35, 0.35, 0.35 ] },
		{ name: 'Door', mesh: 1, translation: [ 0, 1, - 2.2 ], scale: [ 1.4, 2, 0.25 ] },
	],
	meshes: [
		{ name: 'CoinGeom', primitives: [ { attributes: { POSITION: 0, NORMAL: 1 }, material: 0 } ] },
		{ name: 'DoorGeom', primitives: [ { attributes: { POSITION: 0, NORMAL: 1 }, material: 1 } ] },
	],
	materials: [
		{ name: 'Coin', doubleSided: true, pbrMetallicRoughness: { baseColorFactor: [ 1, 0.84, 0.2, 1 ], metallicFactor: 0.6, roughnessFactor: 0.35 } },
		{ name: 'Door', doubleSided: true, pbrMetallicRoughness: { baseColorFactor: [ 0.4, 0.25, 0.15, 1 ], metallicFactor: 0.05, roughnessFactor: 0.85 } },
	],
	accessors: [
		{ bufferView: 0, componentType: 5126, count: vertexCount, type: 'VEC3', min: posBounds.min, max: posBounds.max },
		{ bufferView: 1, componentType: 5126, count: vertexCount, type: 'VEC3' },
	],
	bufferViews: [
		{ buffer: 0, byteOffset: 0, byteLength: posBytes.length, target: 34962 },
		{ buffer: 0, byteOffset: posBytes.length, byteLength: normBytes.length, target: 34962 },
	],
	buffers: [ { byteLength: bin.length } ],
};

const jsonText = JSON.stringify( gltf );
const jsonBytes = Buffer.from( jsonText, 'utf8' );
const jsonPad = ( 4 - ( jsonBytes.length % 4 ) ) % 4;
const jsonChunk = Buffer.concat( [ jsonBytes, Buffer.alloc( jsonPad, 0x20 ) ] ); // pad with spaces

const binPad = ( 4 - ( bin.length % 4 ) ) % 4;
const binChunk = Buffer.concat( [ bin, Buffer.alloc( binPad, 0x00 ) ] ); // pad with zero bytes

function chunkHeader( length, type ) {

	const h = Buffer.alloc( 8 );
	h.writeUInt32LE( length, 0 );
	h.writeUInt32LE( type, 4 );
	return h;

}

const JSON_CHUNK_TYPE = 0x4e4f534a; // 'JSON'
const BIN_CHUNK_TYPE  = 0x004e4942; // 'BIN\0'

const jsonSection = Buffer.concat( [ chunkHeader( jsonChunk.length, JSON_CHUNK_TYPE ), jsonChunk ] );
const binSection  = Buffer.concat( [ chunkHeader( binChunk.length, BIN_CHUNK_TYPE ), binChunk ] );

const totalLength = 12 + jsonSection.length + binSection.length;
const header = Buffer.alloc( 12 );
header.writeUInt32LE( 0x46546c67, 0 ); // 'glTF'
header.writeUInt32LE( 2, 4 );          // version
header.writeUInt32LE( totalLength, 8 );

const glb = Buffer.concat( [ header, jsonSection, binSection ] );

writeFileSync( path.join( __dirname, 'game.glb' ), glb );
console.log( `wrote game.glb (${ glb.length } bytes)` );
