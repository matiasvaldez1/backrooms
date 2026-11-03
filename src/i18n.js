/**
 * Textos en español e inglés.
 *
 * La cita del post original de /x/ NO se traduce: es una cita textual de 2019 y
 * traducirla seria falsearla. El resto de la interfaz si.
 */

const STRINGS = {

	es: {
		'loading.boot': 'cargando',
		'loading.level': 'generando el nivel',
		'loading.uvs': 'desplegando UVs',
		'loading.probes': 'capturando la luz',
		'loading.lightmap': 'horneando la luz',
		'loading.ready': 'listo',

		'start.enter': 'Click para entrar',
		'start.walk': 'caminar',
		'start.run': 'apurarse',
		'start.exit': 'salir',
		'start.interact': 'usar',
		'start.flashlight': 'linterna',

		'pause.title': 'En pausa',
		'pause.resume': 'Click para volver',
		'pause.sound': 'Sonido',
		'pause.language': 'Idioma',
		'pause.on': 'sí',
		'pause.off': 'no',

		'hud.breakers': 'tableros',
		'hud.exitSealed': 'la salida no cede',
		'hud.exitOpen': 'la salida cedió',
		'hud.useBreaker': 'E — levantar el tablero',
		'hud.useExit': 'E — salir',

		'caught': 'te encontró',

		'won.title': 'Saliste',
		'won.body': 'La puerta da a una escalera de servicio. No mires atrás.',
		'won.again': 'F5 para volver a entrar',

		'unsupported.pointer.title': 'Hace falta teclado y mouse',
		'unsupported.pointer.body': 'Esto se camina con WASD y se mira con el mouse. En pantalla táctil no hay forma de jugarlo.',
		'unsupported.pointer.minor': 'Abrilo desde una computadora.',
		'unsupported.gpu.title': 'Hace falta WebGPU',
		'unsupported.gpu.body': 'Este navegador no expone WebGPU. Funciona en Chrome, Edge y Safari recientes.',
		'unsupported.gpu.minor': 'Igual podés <a href="?webgl">entrar en modo WebGL2</a>, pero va a ir a pocos cuadros por segundo.'
	},

	en: {
		'loading.boot': 'loading',
		'loading.level': 'generating the level',
		'loading.uvs': 'unwrapping UVs',
		'loading.probes': 'capturing light',
		'loading.lightmap': 'baking light',
		'loading.ready': 'ready',

		'start.enter': 'Click to enter',
		'start.walk': 'walk',
		'start.run': 'hurry',
		'start.exit': 'release',
		'start.interact': 'use',
		'start.flashlight': 'flashlight',

		'pause.title': 'Paused',
		'pause.resume': 'Click to resume',
		'pause.sound': 'Sound',
		'pause.language': 'Language',
		'pause.on': 'on',
		'pause.off': 'off',

		'hud.breakers': 'breakers',
		'hud.exitSealed': 'the exit holds',
		'hud.exitOpen': 'the exit gave',
		'hud.useBreaker': 'E — raise the breaker',
		'hud.useExit': 'E — leave',

		'caught': 'it found you',

		'won.title': 'You got out',
		'won.body': 'The door opens onto a service stairwell. Do not look back.',
		'won.again': 'F5 to go back in',

		'unsupported.pointer.title': 'Keyboard and mouse required',
		'unsupported.pointer.body': 'You walk with WASD and look with the mouse. There is no way to play this on a touch screen.',
		'unsupported.pointer.minor': 'Open it on a computer.',
		'unsupported.gpu.title': 'WebGPU required',
		'unsupported.gpu.body': 'This browser does not expose WebGPU. It works in recent Chrome, Edge and Safari.',
		'unsupported.gpu.minor': 'You can still <a href="?webgl">enter in WebGL2 mode</a>, but it will run at a few frames per second.'
	}

};

const STORAGE_KEY = 'backrooms.lang';

/** Lo elegido antes, o el idioma del navegador, o español. */
function detect() {

	try {

		const saved = localStorage.getItem( STORAGE_KEY );
		if ( saved && STRINGS[ saved ] ) return saved;

	} catch ( e ) { /* modo privado: seguimos con el default */ }

	return ( navigator.language || 'es' ).toLowerCase().startsWith( 'en' ) ? 'en' : 'es';

}

let current = detect();

export const languages = Object.keys( STRINGS );

export function getLanguage() {

	return current;

}

export function setLanguage( lang ) {

	if ( ! STRINGS[ lang ] ) return;

	current = lang;

	try { localStorage.setItem( STORAGE_KEY, lang ); } catch ( e ) { /* sin persistencia */ }

	applyStatic();

}

/** @param {string} key @returns {string} */
export function t( key ) {

	return STRINGS[ current ][ key ] ?? STRINGS.es[ key ] ?? key;

}

/**
 * Traduce todo lo marcado con data-i18n en el documento. Declarativo para que
 * agregar un texto nuevo no implique tocar tambien el codigo de render.
 */
export function applyStatic() {

	for ( const node of document.querySelectorAll( '[data-i18n]' ) ) {

		node.innerHTML = t( node.dataset.i18n );

	}

	document.documentElement.lang = current;

}
