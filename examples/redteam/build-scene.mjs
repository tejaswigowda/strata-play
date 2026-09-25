// ── build-scene.mjs ──────────────────────────────────────────────────────────
// Regenerates game.glb for the red-team example — a single trivial cube, since
// this example exists to attempt attacks (work order §1.5), not to look like
// anything. See examples/hello/build-scene.mjs for the fuller, commented
// version of this same hand-rolled GLB technique.
//
// Run with: node build-scene.mjs

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname( fileURLToPath( import.meta.url ) );

const positions = [];
const normals = [];

function face( a, b, c, d, n ) {

	for ( const p of [ a, b, c, a, c, d ] ) { positions.push( ...p ); normals.push( ...n ); }

}

const s = 0.5;
face( [ -s, -s,  s ], [  s, -s,  s ], [  s,  s,  s ], [ -s,  s,  s ], [  0,  0,  1 ] );
face( [  s, -s, -s ], [ -s, -s, -s ], [ -s,  s, -s ], [  s,  s, -s ], [  0,  0, -1 ] );
face( [ -s, -s, -s ], [ -s, -s,  s ], [ -s,  s,  s ], [ -s,  s, -s ], [ -1,  0,  0 ] );
face( [  s, -s,  s ], [  s, -s, -s ], [  s,  s, -s ], [  s,  s,  s ], [  1,  0,  0 ] );
face( [ -s,  s,  s ], [  s,  s,  s ], [  s,  s, -s ], [ -s,  s, -s ], [  0,  1,  0 ] );
face( [ -s, -s, -s ], [  s, -s, -s ], [  s, -s,  s ], [ -s, -s,  s ], [  0, -1,  0 ] );

const posArray = new Float32Array( positions );
const normArray = new Float32Array( normals );

function minMax3( arr ) {

	const min = [ Infinity, Infinity, Infinity ];
	const max = [ - Infinity, - Infinity, - Infinity ];
	for ( let i = 0; i < arr.length; i += 3 ) for ( let k = 0; k < 3; k ++ ) {

		min[ k ] = Math.min( min[ k ], arr[ i + k ] );
		max[ k ] = Math.max( max[ k ], arr[ i + k ] );

	}

	return { min, max };

}

const posBounds = minMax3( posArray );
const posBytes = Buffer.from( posArray.buffer );
const normBytes = Buffer.from( normArray.buffer );
const bin = Buffer.concat( [ posBytes, normBytes ] );
const vertexCount = posArray.length / 3;

const gltf = {
	asset: { version: '2.0', generator: 'strata-play build-scene.mjs (redteam)' },
	scene: 0,
	scenes: [ { nodes: [ 0 ] } ],
	nodes: [ { name: 'Target', mesh: 0 } ],
	meshes: [ { name: 'TargetGeom', primitives: [ { attributes: { POSITION: 0, NORMAL: 1 }, material: 0 } ] } ],
	materials: [ { name: 'Target', doubleSided: true, pbrMetallicRoughness: { baseColorFactor: [ 0.8, 0.1, 0.1, 1 ] } } ],
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

const jsonBytes = Buffer.from( JSON.stringify( gltf ), 'utf8' );
const jsonPad = ( 4 - ( jsonBytes.length % 4 ) ) % 4;
const jsonChunk = Buffer.concat( [ jsonBytes, Buffer.alloc( jsonPad, 0x20 ) ] );

const binPad = ( 4 - ( bin.length % 4 ) ) % 4;
const binChunk = Buffer.concat( [ bin, Buffer.alloc( binPad, 0x00 ) ] );

function chunkHeader( length, type ) {

	const h = Buffer.alloc( 8 );
	h.writeUInt32LE( length, 0 );
	h.writeUInt32LE( type, 4 );
	return h;

}

const jsonSection = Buffer.concat( [ chunkHeader( jsonChunk.length, 0x4e4f534a ), jsonChunk ] );
const binSection  = Buffer.concat( [ chunkHeader( binChunk.length, 0x004e4942 ), binChunk ] );

const header = Buffer.alloc( 12 );
header.writeUInt32LE( 0x46546c67, 0 );
header.writeUInt32LE( 2, 4 );
header.writeUInt32LE( 12 + jsonSection.length + binSection.length, 8 );

const glb = Buffer.concat( [ header, jsonSection, binSection ] );
writeFileSync( path.join( __dirname, 'game.glb' ), glb );
console.log( `wrote game.glb (${ glb.length } bytes)` );
