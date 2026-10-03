// ── build-scene.mjs ──────────────────────────────────────────────────────────
// Regenerates game.glb for the pose-input-provider demo (work order §6
// acceptance: "a rigged humanoid... posecaster drives at least one bone chain
// via ctx.onPose + $S-addressed bones"). One shared unit-cube geometry (see
// examples/hello/build-scene.mjs for the fuller comments on this technique),
// a static torso+head, and two ARM PIVOTS (#RightShoulder, #LeftShoulder) —
// each an otherwise-empty transform node whose own rotation game.js sets
// every pose frame, with a plain box mesh child authored hanging straight
// down from the pivot (a relaxed arm-at-sides rest pose) so rotating the
// pivot swings the whole limb. One segment per arm, not a full
// shoulder→elbow→wrist chain — the simplest faithful instance of the
// pattern (aim a bone at a live landmark position); a real rig extends it by
// repeating the same pivot-with-a-child-mesh shape one level deeper per
// joint, same $S-addressing throughout.
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
face( [ -s, -s, s ], [ s, -s, s ], [ s, s, s ], [ -s, s, s ], [ 0, 0, 1 ] );
face( [ s, -s, -s ], [ -s, -s, -s ], [ -s, s, -s ], [ s, s, -s ], [ 0, 0, -1 ] );
face( [ -s, -s, -s ], [ -s, -s, s ], [ -s, s, s ], [ -s, s, -s ], [ -1, 0, 0 ] );
face( [ s, -s, s ], [ s, -s, -s ], [ s, s, -s ], [ s, s, s ], [ 1, 0, 0 ] );
face( [ -s, s, s ], [ s, s, s ], [ s, s, -s ], [ -s, s, -s ], [ 0, 1, 0 ] );
face( [ -s, -s, -s ], [ s, -s, -s ], [ s, -s, s ], [ -s, -s, s ], [ 0, -1, 0 ] );

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
	asset: { version: '2.0', generator: 'strata-play build-scene.mjs (posepuppet)' },
	scene: 0,
	// RightShoulder/LeftShoulder are PURE transform nodes (no mesh of their
	// own) — their own rotation is the "bone"; the box they each parent is
	// just the visible limb riding along with it.
	scenes: [ { nodes: [ 0, 1, 2, 4 ] } ],
	nodes: [
		{ name: 'Torso', mesh: 0, translation: [ 0, 1.8, 0 ], scale: [ 1.2, 1.8, 0.6 ] },
		{ name: 'Head', mesh: 0, translation: [ 0, 3.0, 0 ], scale: [ 0.6, 0.6, 0.6 ] },
		{ name: 'RightShoulder', translation: [ -0.8, 2.6, 0 ], children: [ 3 ] },
		{ name: 'RightArm', mesh: 1, translation: [ 0, - 0.6, 0 ], scale: [ 0.25, 1.2, 0.25 ] },
		{ name: 'LeftShoulder', translation: [ 0.8, 2.6, 0 ], children: [ 5 ] },
		{ name: 'LeftArm', mesh: 2, translation: [ 0, - 0.6, 0 ], scale: [ 0.25, 1.2, 0.25 ] },
	],
	meshes: [
		{ name: 'TorsoHeadGeom', primitives: [ { attributes: { POSITION: 0, NORMAL: 1 }, material: 0 } ] },
		{ name: 'RightArmGeom', primitives: [ { attributes: { POSITION: 0, NORMAL: 1 }, material: 1 } ] },
		{ name: 'LeftArmGeom', primitives: [ { attributes: { POSITION: 0, NORMAL: 1 }, material: 2 } ] },
	],
	materials: [
		mat( 'Body', [ 0.75, 0.75, 0.8, 1 ] ),
		mat( 'RightArm', [ 0.2, 0.5, 1, 1 ] ),
		mat( 'LeftArm', [ 1, 0.3, 0.3, 1 ] ),
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
const binSection = Buffer.concat( [ chunkHeader( binChunk.length, 0x004e4942 ), binChunk ] );

const header = Buffer.alloc( 12 );
header.writeUInt32LE( 0x46546c67, 0 );
header.writeUInt32LE( 2, 4 );
header.writeUInt32LE( 12 + jsonSection.length + binSection.length, 8 );

const glb = Buffer.concat( [ header, jsonSection, binSection ] );
writeFileSync( path.join( __dirname, 'game.glb' ), glb );
console.log( `wrote game.glb (${ glb.length } bytes)` );
