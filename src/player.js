import * as THREE from 'three/webgpu';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';

const EYE_HEIGHT = 1.7;
const RADIUS = 0.38;
const WALK_SPEED = 2.9;          // caminar, no correr: el lugar tiene que sentirse largo
const SPRINT_SPEED = 5.0;
const ACCEL = 13;                // 1 - exp(-ACCEL * dt), independiente del framerate
const STRIDE = 1.85;             // metros entre pasos

// Radio en el que el bicho puede oir un paso. Caminar es casi mudo; correr te
// delata a media sala. Es la decision que convierte a correr en una eleccion.
const WALK_NOISE = 2.5;
const RUN_NOISE = 17;

const BOB_FREQ = 9;
const BOB_AMP = 0.035;
const SWAY_FREQ = 4.5;
const SWAY_AMP = 0.022;

const UP = new THREE.Vector3( 0, 1, 0 );

/**
 * Circulo contra las celdas solidas que toca su AABB.
 * Se chequea por eje separado en update(), que es lo que produce el resbale
 * contra la pared en vez de frenar en seco al rozarla.
 */
function blocked( level, x, z ) {

	const { cell } = level.dims;
	const [ minCx, minCz ] = level.cellOf( x - RADIUS, z - RADIUS );
	const [ maxCx, maxCz ] = level.cellOf( x + RADIUS, z + RADIUS );
	const half = cell / 2;

	for ( let cz = minCz; cz <= maxCz; cz ++ ) {

		for ( let cx = minCx; cx <= maxCx; cx ++ ) {

			const [ centreX, centreZ ] = level.centerOf( cx, cz );
			if ( ! level.isSolid( centreX, centreZ ) ) continue;

			const nearestX = Math.max( centreX - half, Math.min( x, centreX + half ) );
			const nearestZ = Math.max( centreZ - half, Math.min( z, centreZ + half ) );
			const dx = x - nearestX;
			const dz = z - nearestZ;

			if ( dx * dx + dz * dz < RADIUS * RADIUS ) return true;

		}

	}

	return false;

}

export class Player {

	/**
	 * @param {THREE.PerspectiveCamera} camera
	 * @param {HTMLElement} domElement
	 * @param {object} level
	 */
	constructor( camera, domElement, level ) {

		this.camera = camera;
		this.level = level;

		// Pasarle domElement ya conecta los listeners: no llamar connect() tambien.
		this.controls = new PointerLockControls( camera, domElement );
		this.controls.pointerSpeed = 0.9;

		// La posicion del jugador es SUYA, no la de la camara. La camara se compone
		// al final sumando cabeceo y sacudon: si el shake viviera en camera.position,
		// la matematica de colision lo leeria como movimiento real.
		this.position = new THREE.Vector3();
		this.velocity = new THREE.Vector3();
		this.keys = new Set();
		this.running = false;

		/** @type {?import('./feedback.js').Feedback} */
		this.feedback = null;

		/** @type {?(x: number, z: number, radius: number) => void} */
		this.onNoise = null;

		// El Pointer Lock API exige un gesto real del usuario y no engancha bajo
		// automatizacion. Sin este bypass, una verificacion automatizada ve cero
		// movimiento y no puede distinguir "no hubo lock" de "el movimiento esta roto".
		this.ignoreLock = false;
		this.distanceWalked = 0;
		this.nextStepAt = STRIDE;

		/** @type {(() => void) | null} Se dispara por distancia recorrida, no por frame. */
		this.onFootstep = null;

		this._forward = new THREE.Vector3();
		this._right = new THREE.Vector3();
		this._wish = new THREE.Vector3();

		this._onKeyDown = event => {

			this.keys.add( event.code );
			// El navegador scrollea la pagina con espacio aunque haya pointer lock.
			if ( event.code === 'Space' ) event.preventDefault();

		};

		this._onKeyUp = event => this.keys.delete( event.code );

		window.addEventListener( 'keydown', this._onKeyDown );
		window.addEventListener( 'keyup', this._onKeyUp );

	}

	get isLocked() {

		return this.controls.isLocked;

	}

	/** Lock real del jugador, o bypass de test. */
	get isActive() {

		return this.controls.isLocked || this.ignoreLock;

	}

	lock() {

		// unadjustedMovement saltea la aceleracion de mouse del sistema operativo.
		this.controls.lock( true );

	}

	teleportTo( x, z ) {

		this.position.set( x, EYE_HEIGHT, z );
		this.camera.position.copy( this.position );
		this.velocity.set( 0, 0, 0 );
		this.distanceWalked = 0;
		this.nextStepAt = STRIDE;

	}

	/**
	 * @param {number} delta segundos
	 * @param {number} elapsed tiempo de juego acumulado, no performance.now()
	 */
	update( delta, elapsed ) {

		if ( ! this.isActive ) {

			this.velocity.set( 0, 0, 0 );
			this._composeCamera( 0, elapsed );
			return;

		}

		const camera = this.camera;
		const position = this.position;

		camera.getWorldDirection( this._forward );
		this._forward.y = 0;

		// Mirando recto arriba o abajo el forward aplanado degenera; se mantiene el anterior.
		if ( this._forward.lengthSq() > 1e-6 ) this._forward.normalize();

		// right = forward x up  (con Y arriba y forward en -Z, da +X)
		this._right.crossVectors( this._forward, UP ).normalize();

		const keys = this.keys;
		const ahead = ( keys.has( 'KeyW' ) || keys.has( 'ArrowUp' ) ? 1 : 0 )
			- ( keys.has( 'KeyS' ) || keys.has( 'ArrowDown' ) ? 1 : 0 );
		const side = ( keys.has( 'KeyD' ) || keys.has( 'ArrowRight' ) ? 1 : 0 )
			- ( keys.has( 'KeyA' ) || keys.has( 'ArrowLeft' ) ? 1 : 0 );

		this._wish.set( 0, 0, 0 )
			.addScaledVector( this._forward, ahead )
			.addScaledVector( this._right, side );

		// Normalizar o en diagonal se camina 1.41x mas rapido.
		if ( this._wish.lengthSq() > 1e-6 ) this._wish.normalize();

		this.running = keys.has( 'ShiftLeft' ) || keys.has( 'ShiftRight' );
		const speed = this.running ? SPRINT_SPEED : WALK_SPEED;

		this._wish.multiplyScalar( speed );

		const smoothing = 1 - Math.exp( - ACCEL * delta );
		this.velocity.lerp( this._wish, smoothing );

		// Resolucion por eje: mover X, revertir si choca; despues Z. Asi resbala.
		const stepX = this.velocity.x * delta;
		const stepZ = this.velocity.z * delta;

		if ( stepX !== 0 ) {

			const target = position.x + stepX;
			if ( blocked( this.level, target, position.z ) ) {

				this.velocity.x = 0;

			} else {

				position.x = target;

			}

		}

		if ( stepZ !== 0 ) {

			const target = position.z + stepZ;
			if ( blocked( this.level, position.x, target ) ) {

				this.velocity.z = 0;

			} else {

				position.z = target;

			}

		}

		const planarSpeed = Math.hypot( this.velocity.x, this.velocity.z );
		this.distanceWalked += planarSpeed * delta;

		if ( this.distanceWalked >= this.nextStepAt ) {

			this.nextStepAt = this.distanceWalked + STRIDE;
			if ( this.onFootstep !== null ) this.onFootstep( this.running );

			// El ruido se emite CON el paso, no por frame: un evento discreto que
			// el bicho puede oir, no un campo continuo.
			if ( this.onNoise !== null ) {

				this.onNoise( position.x, position.z, this.running ? RUN_NOISE : WALK_NOISE );

			}

		}

		const gait = Math.min( planarSpeed / WALK_SPEED, 1.4 );
		this._composeCamera( gait, elapsed );

	}

	/**
	 * La camara = posicion del jugador + cabeceo + sacudon. En ese orden y en un
	 * solo lugar, para que nada de lo cosmetico se filtre a la simulacion.
	 */
	_composeCamera( gait, elapsed ) {

		const camera = this.camera;

		camera.position.copy( this.position );
		camera.position.y += Math.sin( elapsed * BOB_FREQ ) * BOB_AMP * gait;

		const sway = Math.sin( elapsed * SWAY_FREQ ) * SWAY_AMP * gait;

		if ( this.feedback !== null ) {

			camera.position.add( this.feedback.shakeOffset );
			// El roll sobrevive: PointerLockControls lee el euler en YXZ, toca
			// solo .y y .x, y reescribe los tres.
			camera.rotation.z = sway + this.feedback.roll;

		} else {

			camera.rotation.z = sway;

		}

	}

	dispose() {

		window.removeEventListener( 'keydown', this._onKeyDown );
		window.removeEventListener( 'keyup', this._onKeyUp );
		this.controls.dispose();

	}

}

export { EYE_HEIGHT, RADIUS };
