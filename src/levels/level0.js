import { randInt } from '../rng.js';

/**
 * Level 0 — el del post original de /x/.
 *
 * Una definicion de nivel aporta cuatro cosas, no solo numeros: su generador de
 * planta, su paleta, su regla de iluminacion y su criatura. Un nivel del
 * Backrooms no es "el mismo lugar con otras medidas" — las Poolrooms no son esto
 * con azulejo, son otra arquitectura, otra luz y otra cosa persiguiendote.
 */

/**
 * "approximately six hundred million square miles of randomly segmented empty rooms".
 * Se arranca de planta libre y se insertan tiradas de pared con huecos, en vez de
 * cavar un laberinto: da habitaciones grandes de forma irregular con vanos sin
 * puerta, que es lo que se ve en el post. Un laberinto da pasillos, que no es lo mismo.
 *
 * @param {() => number} rand
 * @param {{ grid: number }} dims
 * @returns {Uint8Array} 1 = solido
 */
function generatePlan( rand, dims ) {

	const { grid } = dims;
	const index = ( x, z ) => z * grid + x;
	const solid = new Uint8Array( grid * grid );

	// Perimetro cerrado: no hay salida por el borde.
	for ( let i = 0; i < grid; i ++ ) {

		solid[ index( i, 0 ) ] = 1;
		solid[ index( i, grid - 1 ) ] = 1;
		solid[ index( 0, i ) ] = 1;
		solid[ index( grid - 1, i ) ] = 1;

	}

	// 42 tiradas, no 110: con mas, se superponen hasta volverse masa solida y la
	// region abierta mas grande queda siendo un bolsillo del 15%.
	const runs = Math.round( grid * grid * 0.041 );

	for ( let r = 0; r < runs; r ++ ) {

		const horizontal = rand() < 0.5;
		const len = randInt( rand, 5, 13 );
		const sx = randInt( rand, 1, grid - 2 );
		const sz = randInt( rand, 1, grid - 2 );

		// Un vano cada ~4 celdas. Fijo en dos, las tiradas largas quedan
		// impenetrables y el nivel se parte en cuartos cerrados.
		const gaps = new Set();
		for ( let g = 0; g < Math.max( 2, Math.round( len / 4 ) ); g ++ ) {

			gaps.add( randInt( rand, 0, len - 1 ) );

		}

		for ( let i = 0; i < len; i ++ ) {

			if ( gaps.has( i ) ) continue;

			const x = horizontal ? sx + i : sx;
			const z = horizontal ? sz : sz + i;

			if ( x < 1 || x >= grid - 1 || z < 1 || z >= grid - 1 ) continue;

			solid[ index( x, z ) ] = 1;

		}

	}

	return solid;

}

export default {

	id: 'level-0',
	name: 'Level 0',

	// 32 * 2 = 64m de lado. El atlas del lightmap se dimensiona contra la
	// superficie total: agrandar esto baja los texels por metro.
	dims: { grid: 32, cell: 2, wallHeight: 3 },

	generatePlan,

	// Cada losa decide cada cuantos metros repite su textura. La pared nunca
	// tilea en vertical (el rodapie aparece una sola vez) — eso lo fija el builder.
	surfaces: {
		floorTiles: 4, floorMetresPerRepeat: 4,
		ceilingTiles: 4, ceilingMetresPerRepeat: 2
	},

	// La bruma amarilla impide ver el borde de un nivel finito.
	fog: { color: 0x221d0e, near: 6, far: 34 },

	palette: {
		wallpaper: '#c3b26a',
		wallpaperSeam: 'rgba(90, 78, 38, 0.16)',
		damp: 'rgba(78, 62, 26',       // se completa con el alpha en materials.js
		carpet: '#4a4330',
		carpetStain: 'rgba(30, 26, 16',
		ceilingTile: '#b3ad92',
		ceilingGrid: 'rgba(58, 54, 40, 0.55)',
		ceilingLeak: 'rgba(116, 96, 48',
		diffuseRoughness: { wall: 0.7, floor: 0.9, ceiling: 0.55 }
	},

	// Fluorescentes de techo. Candela con falloff inverso al cuadrado.
	lighting: {
		spacing: 3,                 // celdas entre artefactos → uno cada 6m
		intensity: 26,
		range: 11,
		color: 0xfff4c4,
		aliveEmissive: 0xfff6d2,
		deadEmissive: 0x2e2c22,
		deadZones: 4,
		strayDeadChance: 0.06,
		flickerChance: 0.09,
		ambientFallback: { color: 0xb5a46a, intensity: 0.16 }
	},

	// Tuning de la criatura de este nivel.
	//
	// Dos invariantes que no se tocan:
	//   loseDistance > maxSpawnDistance  — si no, toda aparicion lejana se
	//     auto-descarta en el primer frame
	//   darkHuntSpeed < 5.0 (correr)     — si no, no hay escape posible
	entity: {
		height: 2.35,

		// Velocidad y deteccion escalan con la luz local. A oscuras es otra cosa:
		// mas rapido y con mas alcance. Encender un sector le quita terreno.
		litStalkSpeed: 1.3, darkStalkSpeed: 2.1,
		litHuntSpeed: 3.0, darkHuntSpeed: 4.0,
		litNoticeDistance: 7, darkNoticeDistance: 13,

		catchDistance: 1.15,
		loseDistance: 34,
		loseTimeout: 7,
		cooldown: 6,                // ventana de recuperacion tras perderte
		maxLifetime: 80,
		minSpawnDistance: 19,
		maxSpawnDistance: 28,
		dormantMin: 26,
		dormantMax: 55,

		// Rondar: waypoints sesgados hacia tu mitad del mapa, para que el
		// encuentro pase sin que se sienta guionado.
		wanderBias: 0.55,
		wanderArrival: 1.6
	}

};
