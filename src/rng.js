// RNG determinista. Nada en el juego usa Math.random():
// el timer del enemigo y el layout tienen que ser reproducibles para poder
// volver a una situacion exacta cuando algo sale mal.

/**
 * mulberry32 — rapido, periodo suficiente, 32 bits de estado.
 * @param {number} seed
 * @returns {() => number} float en [0, 1)
 */
export function createRng( seed ) {

	let a = seed >>> 0;

	return function () {

		a = ( a + 0x6D2B79F5 ) >>> 0;
		let t = Math.imul( a ^ ( a >>> 15 ), 1 | a );
		t = ( t + Math.imul( t ^ ( t >>> 7 ), 61 | t ) ) ^ t;
		return ( ( t ^ ( t >>> 14 ) ) >>> 0 ) / 4294967296;

	};

}

/** Entero en [min, max]. */
export function randInt( rand, min, max ) {

	return min + Math.floor( rand() * ( max - min + 1 ) );

}

/** Elemento al azar de un array. */
export function pick( rand, array ) {

	return array[ Math.floor( rand() * array.length ) ];

}
