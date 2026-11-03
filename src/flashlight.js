import * as THREE from 'three/webgpu';

// Decay 1.0 en vez del 2.0 fisico. Es una decision deliberada, no un descuido:
// con inverso al cuadrado, calibrar el cono para que alcance a 8m deja 230 lux a
// un metro, y como aca uno camina pegado a las paredes todo el tiempo, la pantalla
// se satura a blanco puro constantemente. Con decay 1.0 el mismo brillo a 8m
// necesita 30 candela, y el punto mas cercano queda 8x mas bajo.
const INTENSITY = 30;
const DECAY = 1.0;
const RANGE = 24;
const ANGLE = THREE.MathUtils.degToRad( 23 );
const PENUMBRA = 0.5;

// Sostenida a la altura del pecho, apenas a la derecha.
const OFFSET = new THREE.Vector3( 0.28, - 0.22, 0 );

/**
 * La unica luz con sombra del juego. Cada point light con sombra cuesta seis
 * pasadas de depth, asi que los ~60 fluorescentes no proyectan ninguna: el
 * contacto y la direccionalidad los pone esta sola.
 */
export class Flashlight {

	/** @param {THREE.PerspectiveCamera} camera */
	constructor( camera ) {

		this.camera = camera;
		this.on = true;
		this._lagYaw = 0;
		this._lagPitch = 0;

		const light = new THREE.SpotLight( 0xfff1d0, 0, RANGE, ANGLE, PENUMBRA, DECAY );
		light.position.copy( OFFSET );
		light.castShadow = true;

		light.shadow.mapSize.set( 1024, 1024 );
		light.shadow.camera.near = 0.2;
		// No tocar shadow.camera.far ni .fov: el renderer los sobreescribe cada
		// frame desde light.distance y light.angle * shadow.focus.
		light.shadow.normalBias = 0.022;   // mejor que bias en geometria de cajas
		light.shadow.bias = - 0.0004;
		light.shadow.radius = 2;

		// El target cuelga de la camara y lleva el MISMO offset que la luz. Si se
		// lo deja en el origen, el haz sale desde 22cm mas abajo apuntando a la
		// altura de los ojos, o sea inclinado ~12 grados hacia arriba: ilumina el
		// cielorraso en vez del pasillo.
		light.target.position.set( OFFSET.x, OFFSET.y, OFFSET.z - 1 );

		camera.add( light );
		camera.add( light.target );

		this.light = light;

	}

	toggle() {

		// Por intensity y no por .visible ni castShadow: tocar castShadow
		// recompila todos los materiales iluminados.
		this.on = ! this.on;
		return this.on;

	}

	/**
	 * @param {number} delta
	 * @param {number} elapsed tiempo de juego acumulado
	 * @param {number} speed velocidad planar actual, para el bamboleo
	 */
	update( delta, elapsed, speed ) {

		if ( ! this.on ) {

			this.light.intensity = 0;
			return;

		}

		// Temblor leve de contacto flojo. No es un parpadeo dramatico: es una
		// linterna que ya viene usada.
		const unstable = 0.94 + 0.06 * Math.sin( elapsed * 37 )
			+ ( Math.sin( elapsed * 2.3 ) > 0.985 ? - 0.5 : 0 );

		this.light.intensity = INTENSITY * unstable;

		// Retardo del haz respecto de la mano: el cono llega un instante tarde.
		const sway = Math.sin( elapsed * 4.5 ) * 0.016 * Math.min( speed / 2.9, 1.3 );
		const smoothing = 1 - Math.exp( - 9 * delta );

		this._lagYaw += ( sway - this._lagYaw ) * smoothing;
		this._lagPitch += ( Math.sin( elapsed * 9 ) * 0.01 * Math.min( speed / 2.9, 1.3 ) - this._lagPitch ) * smoothing;

		this.light.target.position.set(
			OFFSET.x + this._lagYaw,
			OFFSET.y + this._lagPitch,
			OFFSET.z - 1
		);

	}

}
