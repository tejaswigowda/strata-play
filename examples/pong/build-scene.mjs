// ── build-scene.mjs ──────────────────────────────────────────────────────────
// Regenerates game.glb for Pong (work order §7). One shared unit-cube
// geometry (see examples/hello/build-scene.mjs for the fuller comments on
// this technique), six differently-scaled/positioned/materialed nodes. Labels
// ride along as glTF node "extras" (copied into userData by GLTFLoader, then
// promoted to 3DOM custom classes by sandbox.html's applyExtrasAsClasses):
//   Court, Wall Left, Wall Right -> .static
//   PlayerPaddle, AIPaddle       -> .kinematic (script/input-driven)
//   Ball                         -> .dynamic, collider:"sphere", ccd:true
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

function mat( name, color ) {

	return { name, doubleSided: true, pbrMetallicRoughness: { baseColorFactor: color, metallicFactor: 0.1, roughnessFactor: 0.7 } };

}

const gltf = {
	asset: { version: '2.0', generator: 'strata-play build-scene.mjs (pong)' },
	scene: 0,
	scenes: [ { nodes: [ 0, 1, 2, 3, 4, 5 ] } ],
	nodes: [
		{ name: 'Court', mesh: 0, translation: [ 0, - 0.1, 0 ], scale: [ 6, 0.2, 10 ], extras: { classes: [ 'static' ] } },
		{ name: 'Wall 1', mesh: 1, translation: [ - 3.1, 0.5, 0 ], scale: [ 0.2, 1, 10 ], extras: { classes: [ 'static' ] } },
		{ name: 'Wall 2', mesh: 1, translation: [ 3.1, 0.5, 0 ], scale: [ 0.2, 1, 10 ], extras: { classes: [ 'static' ] } },
		{ name: 'PlayerPaddle', mesh: 2, translation: [ 0, 0.25, 4.5 ], scale: [ 1, 0.5, 0.3 ], extras: { classes: [ 'kinematic' ] } },
		{ name: 'AIPaddle', mesh: 3, translation: [ 0, 0.25, - 4.5 ], scale: [ 1, 0.5, 0.3 ], extras: { classes: [ 'kinematic' ] } },
		{ name: 'Ball', mesh: 4, translation: [ 0, 0.15, 0 ], scale: [ 0.3, 0.3, 0.3 ], extras: { classes: [ 'dynamic' ], collider: 'sphere', ccd: true } },
	],
	meshes: [
		{ name: 'CourtGeom', primitives: [ { attributes: { POSITION: 0, NORMAL: 1 }, material: 0 } ] },
		{ name: 'WallGeom', primitives: [ { attributes: { POSITION: 0, NORMAL: 1 }, material: 1 } ] },
		{ name: 'PlayerGeom', primitives: [ { attributes: { POSITION: 0, NORMAL: 1 }, material: 2 } ] },
		{ name: 'AIGeom', primitives: [ { attributes: { POSITION: 0, NORMAL: 1 }, material: 3 } ] },
		{ name: 'BallGeom', primitives: [ { attributes: { POSITION: 0, NORMAL: 1 }, material: 4 } ] },
	],
	materials: [
		mat( 'Court', [ 0.15, 0.16, 0.2, 1 ] ),
		mat( 'Wall', [ 0.3, 0.3, 0.35, 1 ] ),
		mat( 'Player', [ 0.2, 0.5, 1, 1 ] ),
		mat( 'AI', [ 1, 0.3, 0.3, 1 ] ),
		mat( 'Ball', [ 1, 1, 1, 1 ] ),
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
