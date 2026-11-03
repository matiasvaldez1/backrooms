import * as THREE from 'three/webgpu';

/**
 * Impacto de cámara: trauma, hitstop, destello y golpe de FOV.
 *
 * Los números salen de la tabla de `game-feel.md`, con una desviación marcada:
 * su `MAX_OFFSET` de 0.55 asume una cámara de seguimiento en tercera persona.
 * En primera persona el mismo desplazamiento se lee amplificadísimo — 27cm de
 * sacudón a la altura de los ojos marea en vez de golpear. Acá va 0.18.
 */

const TRAUMA_DECAY = 1.4;        // unidades por segundo
const MAX_OFFSET = 0.18;         // metros a trauma pleno (0.55 en tercera persona)
const MAX_ROLL = 0.07;           // radianes a trauma pleno

/**
 * Ruido determinista. Se alimenta de tiempo de juego acumulado, no del reloj de
 * pared: si no, el sacudón se desincroniza de la simulación al caer frames.
 */
function pseudoNoise( t, seed ) {

	const x = Math.sin( t * 12.9898 + seed * 78.233 ) * 43758.5453;
	return ( x - Math.floor( x ) ) * 2 - 1;

}

export class Feedback {

	/**
	 * @param {THREE.PerspectiveCamera} camera
	 * @param {HTMLElement} flashElement
	 */
	constructor( camera, flashElement ) {

		this.camera = camera;
		this.flashElement = flashElement;

		this.trauma = 0;
		this.time = 0;

		this.hitstopRemaining = 0;
		this.hitstopScale = 1;

		this.baseFov = camera.fov;
		this.fovPunch = 0;

		/** Compuesto por el jugador sobre su posición. */
		this.shakeOffset = new THREE.Vector3();
		this.roll = 0;

	}

	/**
	 * Multiplicador del delta de GAMEPLAY. El loop de render nunca se escala:
	 * el cuadro tiene que seguir dibujándose o el congelado no se ve.
	 */
	get timeScale() {

		return this.hitstopRemaining > 0 ? this.hitstopScale : 1;

	}

	/** 0..1. Lo usa el audio para agachar el ambiente mientras dura el impacto. */
	get duck() {

		return this.hitstopRemaining > 0 ? 0.6 : 1;

	}

	/** Recomendado: recoger 0.15, golpe 0.4, muerte 0.7. Tope duro en 1. */
	addTrauma( amount ) {

		this.trauma = Math.min( 1, this.trauma + amount );

	}

	/** Reservado para contacto pesado. En eventos menores el juego se siente laggeado. */
	hitstop( milliseconds, scale = 0.05 ) {

		this.hitstopRemaining = Math.max( this.hitstopRemaining, milliseconds / 1000 );
		this.hitstopScale = scale;

	}

	/** Destello por DOM: más barato que un render target y no toca el pipeline 3D. */
	flash( peak = 0.8, milliseconds = 110 ) {

		if ( this.flashElement === null ) return;

		this.flashElement.animate(
			[ { opacity: peak }, { opacity: 0 } ],
			{ duration: milliseconds, easing: 'ease-out' }
		);

	}

	/** +4..8 grados. Sin updateProjectionMatrix() no se ve nada. */
	punchFov( degrees ) {

		this.fovPunch = Math.min( 10, this.fovPunch + degrees );

	}

	/**
	 * @param {number} realDelta delta REAL, no escalado. El feedback sigue vivo
	 * durante el hitstop: si se congelara también, no habría nada que mirar.
	 */
	update( realDelta ) {

		this.time += realDelta;

		if ( this.hitstopRemaining > 0 ) this.hitstopRemaining -= realDelta;

		this.trauma = Math.max( 0, this.trauma - TRAUMA_DECAY * realDelta );

		// Al cuadrado: los eventos chicos apenas mueven la cámara y los grandes pegan.
		const shake = this.trauma * this.trauma;
		const freq = this.time * 32;

		this.shakeOffset.set(
			MAX_OFFSET * shake * pseudoNoise( freq, 1 ),
			MAX_OFFSET * shake * pseudoNoise( freq, 2 ),
			MAX_OFFSET * shake * pseudoNoise( freq, 3 )
		);

		// El roll va en camera.rotation.z y sobrevive: PointerLockControls lee el
		// euler en orden YXZ, toca solo .y y .x, y reescribe los tres.
		this.roll = MAX_ROLL * shake * pseudoNoise( freq, 4 );

		if ( this.fovPunch > 0.001 ) {

			this.fovPunch *= Math.exp( - realDelta / 0.2 );
			if ( this.fovPunch < 0.001 ) this.fovPunch = 0;

			this.camera.fov = this.baseFov + this.fovPunch;
			this.camera.updateProjectionMatrix();

		}

	}

	reset() {

		this.trauma = 0;
		this.hitstopRemaining = 0;
		this.fovPunch = 0;
		this.shakeOffset.set( 0, 0, 0 );
		this.roll = 0;
		this.camera.fov = this.baseFov;
		this.camera.updateProjectionMatrix();

	}

}
