import * as THREE from 'three/webgpu';
// Las velocidades, distancias y tiempos vienen de la definicion del nivel
// (`levels/*.js`, clave `entity`). Dos invariantes que viven ahi y no se tocan:
// `loseDistance > maxSpawnDistance` — si no, toda aparicion lejana se
// auto-descarta en el primer frame; y la velocidad de caza tiene que quedar por
// debajo de la de correr del jugador, o no hay escape posible.
//
// Lo que queda aca es la forma de la criatura: si un nivel necesita otra cosa
// persiguiendote, lo que cambia es el modulo entero, no estos numeros.
const REPATH_EVERY = 0.4;

// La silueta se arma con estas proporciones y despues se escala a la altura que
// pida el nivel. Las proporciones son el punto — cuello largo de mas, brazos por
// debajo de las rodillas — asi que se escalan juntas y no por separado.
const NOMINAL_HEIGHT = 2.35;

/** Raycast burdo sobre el grid: muestrea cada media celda. */
function hasLineOfSight( level, ax, az, bx, bz ) {

	const dx = bx - ax;
	const dz = bz - az;
	const distance = Math.hypot( dx, dz );
	const steps = Math.ceil( distance / ( level.dims.cell * 0.5 ) );

	for ( let i = 1; i < steps; i ++ ) {

		const t = i / steps;
		if ( level.isSolid( ax + dx * t, az + dz * t ) ) return false;

	}

	return true;

}

/** BFS sobre celdas abiertas. Devuelve centros en mundo, o null. */
function findPath( level, fromCell, toCell ) {

	const { grid, centerOf } = level.dims;

	const start = fromCell[ 1 ] * grid + fromCell[ 0 ];
	const goal = toCell[ 1 ] * grid + toCell[ 0 ];
	if ( start === goal ) return [];

	const prev = new Int32Array( grid * grid ).fill( - 1 );
	const seen = new Uint8Array( grid * grid );
	const queue = [ start ];
	seen[ start ] = 1;

	for ( let head = 0; head < queue.length; head ++ ) {

		const current = queue[ head ];
		if ( current === goal ) break;

		const cx = current % grid;
		const cz = ( current - cx ) / grid;

		for ( const [ dx, dz ] of [ [ 1, 0 ], [ - 1, 0 ], [ 0, 1 ], [ 0, - 1 ] ] ) {

			const nx = cx + dx;
			const nz = cz + dz;
			if ( nx < 1 || nz < 1 || nx >= grid - 1 || nz >= grid - 1 ) continue;

			const next = nz * grid + nx;
			if ( seen[ next ] ) continue;

			const [ wx, wz ] = centerOf( nx, nz );
			if ( level.isSolid( wx, wz ) ) continue;

			seen[ next ] = 1;
			prev[ next ] = current;
			queue.push( next );

		}

	}

	if ( ! seen[ goal ] ) return null;

	const path = [];
	for ( let node = goal; node !== start && node !== - 1; node = prev[ node ] ) {

		const cx = node % grid;
		const cz = ( node - cx ) / grid;
		path.push( centerOf( cx, cz ) );

	}

	return path.reverse();

}

/**
 * Proporciones deliberadamente mal. Lo que inquieta de una figura no es que sea
 * monstruosa, es que sea casi humana con algo medido mal: el cuello demasiado
 * largo, los brazos colgando por debajo de las rodillas, los hombros angostos.
 * Una caja no da eso; una figura con las razones equivocadas si.
 */
function buildMesh( height ) {

	const root = new THREE.Group();
	root.name = 'entidad';

	const skin = new THREE.MeshStandardNodeMaterial( {
		color: 0x0d0d0a,
		roughness: 1,
		metalness: 0
	} );

	const limb = ( w, h, d ) => {

		const mesh = new THREE.Mesh( new THREE.BoxGeometry( w, h, d ), skin );
		mesh.castShadow = true;
		// Pivote arriba: el hombro y la cadera, no el centro del miembro.
		mesh.geometry.translate( 0, - h / 2, 0 );
		return mesh;

	};

	const HIP = 1.02;
	const SHOULDER = 1.78;

	const legL = limb( 0.13, HIP, 0.13 );
	const legR = limb( 0.13, HIP, 0.13 );
	legL.position.set( - 0.11, HIP, 0 );
	legR.position.set( 0.11, HIP, 0 );

	const torso = new THREE.Mesh( new THREE.BoxGeometry( 0.34, 0.78, 0.22 ), skin );
	torso.position.y = HIP + 0.39;
	torso.castShadow = true;

	// Brazos que llegan mas abajo que las rodillas.
	const armL = limb( 0.09, 0.97, 0.09 );
	const armR = limb( 0.09, 0.97, 0.09 );
	armL.position.set( - 0.21, SHOULDER, 0 );
	armR.position.set( 0.21, SHOULDER, 0 );

	// Cuello largo de mas.
	const neck = new THREE.Mesh( new THREE.BoxGeometry( 0.08, 0.26, 0.08 ), skin );
	neck.position.y = SHOULDER + 0.13;

	const headPivot = new THREE.Group();
	headPivot.position.y = SHOULDER + 0.26;

	const head = new THREE.Mesh( new THREE.BoxGeometry( 0.21, 0.24, 0.2 ), skin );
	head.position.y = 0.12;
	head.castShadow = true;

	// fog: false — los ojos atraviesan la bruma. Se ven antes que el cuerpo,
	// que es el orden en que uno quiere enterarse.
	const eyeMaterial = new THREE.MeshBasicNodeMaterial( { color: 0x6b6450, fog: false } );
	const eyeGeometry = new THREE.SphereGeometry( 0.028, 8, 6 );

	for ( const x of [ - 0.052, 0.052 ] ) {

		const eye = new THREE.Mesh( eyeGeometry, eyeMaterial );
		eye.position.set( x, 0.15, - 0.1 );
		headPivot.add( eye );

	}

	headPivot.add( head );
	root.add( legL, legR, torso, armL, armR, neck, headPivot );

	root.visible = false;
	root.scale.setScalar( height / NOMINAL_HEIGHT );

	root.userData.rig = { legL, legR, armL, armR, torso, headPivot, eyeMaterial };
	return root;

}

const EYE_DIM = new THREE.Color( 0x6b6450 );
const EYE_LIT = new THREE.Color( 0xfff4d2 );

export class Entity {

	/**
	 * @param {THREE.Scene} scene
	 * @param {object} level
	 * @param {() => number} rand
	 * @param {object} audio
	 */
	constructor( scene, level, lighting, rand, audio ) {

		this.level = level;
		this.lighting = lighting;
		this.config = level.definition.entity;
		this.rand = rand;
		this.audio = audio;

		this.mesh = buildMesh( this.config.height );
		scene.add( this.mesh );

		this.state = 'dormant';
		this.timer = 12;              // primera aparicion: que entre en confianza antes
		this.path = null;
		this.repathIn = 0;
		this.blindFor = 0;
		this.lifetime = 0;
		this.distance = Infinity;
		this.phase = 0;
		this.noticed = false;
		this.voice = null;
		this._lastStepPhase = 0;

		this.lightLevel = 1;
		this.coolFor = 0;
		this.waypoint = null;
		this.noiseTarget = null;
		this._facing = new THREE.Vector3( 0, 0, 1 );

		this._target = new THREE.Vector3();

	}

	/** @param {{ step: () => void }} voice voz posicional, cuando el audio arranque */
	setVoice( voice ) {

		this.voice = voice;

	}

	get active() {

		return this.state !== 'dormant';

	}

	reset() {

		this.state = 'dormant';
		this.timer = this.rand() * ( this.config.dormantMax - this.config.dormantMin ) + this.config.dormantMin;
		this.mesh.visible = false;
		this.path = null;
		this.distance = Infinity;
		this.blindFor = 0;
		this.lifetime = 0;
		this.coolFor = 0;
		this.waypoint = null;
		this.noiseTarget = null;

	}

	/**
	 * Oyo un ruido. Caminar casi no suena; correr te delata a media sala.
	 * Es un sentido nuevo, no una busqueda del ultimo punto donde te vio.
	 * @returns {boolean} true si lo registro
	 */
	hear( x, z, radius ) {

		if ( this.state === 'dormant' || this.state === 'hunting' ) return false;

		const position = this.mesh.position;
		if ( Math.hypot( position.x - x, position.z - z ) > radius ) return false;

		this.noiseTarget = [ x, z ];
		this.state = 'investigating';
		this.path = null;
		this.repathIn = 0;
		return true;

	}

	/** Un punto abierto al azar, sesgado hacia la mitad del mapa donde estas. */
	_pickWaypoint( playerPosition ) {

		const points = this.level.spawnPoints;
		const biased = this.rand() < this.config.wanderBias;

		for ( let attempt = 0; attempt < 24; attempt ++ ) {

			const [ x, z ] = points[ Math.floor( this.rand() * points.length ) ];
			const d = Math.hypot( x - playerPosition.x, z - playerPosition.z );

			// Sesgado: cerca tuyo pero no encima. Sin sesgo: cualquier lado.
			if ( biased ? ( d > 8 && d < 26 ) : d > 6 ) return [ x, z ];

		}

		return points[ Math.floor( this.rand() * points.length ) ];

	}

	_spawn( playerPosition ) {

		// Lejos y fuera de vista. Si no hay ningun punto que cumpla, se deja
		// dormido y se reintenta: aparecer delante de los ojos arruina el efecto.
		const candidates = this.level.spawnPoints.filter( ( [ x, z ] ) => {

			const d = Math.hypot( x - playerPosition.x, z - playerPosition.z );
			if ( d < this.config.minSpawnDistance || d > this.config.maxSpawnDistance ) return false;
			return ! hasLineOfSight( this.level, x, z, playerPosition.x, playerPosition.z );

		} );

		if ( candidates.length === 0 ) {

			this.timer = 6;
			return;

		}

		const [ x, z ] = candidates[ Math.floor( this.rand() * candidates.length ) ];
		this.mesh.position.set( x, 0, z );
		this.mesh.visible = true;
		this.state = 'wandering';
		this.path = null;
		this.repathIn = 0;
		this.blindFor = 0;
		this.lifetime = 0;
		this.coolFor = 0;
		this.waypoint = null;
		this.noiseTarget = null;

		this.audio.spawnCue();

	}

	/**
	 * @returns {boolean} true si alcanzo al jugador en este frame
	 */
	update( delta, playerPosition ) {

		if ( this.state === 'dormant' ) {

			this.timer -= delta;
			if ( this.timer <= 0 ) this._spawn( playerPosition );
			return false;

		}

		const position = this.mesh.position;
		this.distance = Math.hypot( position.x - playerPosition.x, position.z - playerPosition.z );

		const config = this.config;
		const sees = hasLineOfSight( this.level, position.x, position.z, playerPosition.x, playerPosition.z );

		this.lifetime += delta;

		// Luz local donde esta PARADO el bicho. A oscuras ve mas lejos y se mueve
		// mas rapido: encender un sector no lo ahuyenta, le quita ventaja.
		const light = this.lighting.lightLevelAt( position.x, position.z );
		this.lightLevel = light;

		const mix = ( dark, lit ) => dark + ( lit - dark ) * light;
		const noticeDistance = mix( config.darkNoticeDistance, config.litNoticeDistance );

		// --- transiciones ------------------------------------------------------

		if ( sees && this.distance < noticeDistance ) {

			this.state = 'hunting';
			this.blindFor = 0;

		} else if ( this.state === 'hunting' ) {

			// La paciencia solo corre si YA te habia visto. Mientras ronda viene
			// por detras de las paredes sin verte nunca.
			this.blindFor += delta;

			if ( this.blindFor > config.loseTimeout ) {

				// Te perdio. No vuelve a rondar de una: se queda. Es la ventana de
				// recuperacion — el momento en que el jugador puede respirar y
				// decidir, que es justo lo que no existia antes.
				this.state = 'cooling';
				this.coolFor = config.cooldown;
				this.blindFor = 0;
				this.path = null;

			}

		} else if ( this.state === 'cooling' ) {

			this.coolFor -= delta;
			if ( this.coolFor <= 0 ) this.state = 'wandering';

		}

		// Se va: le sacaste distancia de verdad, o ya estuvo demasiado tiempo.
		if ( this.distance > config.loseDistance || this.lifetime > config.maxLifetime ) {

			this.reset();
			return false;

		}

		// --- a donde va --------------------------------------------------------

		let target = null;

		if ( this.state === 'hunting' ) {

			target = [ playerPosition.x, playerPosition.z ];

		} else if ( this.state === 'investigating' ) {

			target = this.noiseTarget;

			if ( target === null
				|| Math.hypot( position.x - target[ 0 ], position.z - target[ 1 ] ) < config.wanderArrival ) {

				// Llego al ruido y no habia nadie. Vuelve a rondar desde ahi.
				this.noiseTarget = null;
				this.state = 'wandering';
				this.waypoint = null;
				target = null;

			}

		}

		if ( target === null && this.state !== 'cooling' ) {

			if ( this.waypoint === null
				|| Math.hypot( position.x - this.waypoint[ 0 ], position.z - this.waypoint[ 1 ] ) < config.wanderArrival ) {

				this.waypoint = this._pickWaypoint( playerPosition );
				this.path = null;

			}

			target = this.waypoint;

		}

		// --- movimiento --------------------------------------------------------

		const speed = this.state === 'cooling' ? 0
			: this.state === 'hunting' ? mix( config.darkHuntSpeed, config.litHuntSpeed )
				: mix( config.darkStalkSpeed, config.litStalkSpeed );

		if ( speed > 0 && target !== null ) {

			this.repathIn -= delta;

			if ( this.repathIn <= 0 || this.path === null || this.path.length === 0 ) {

				this.repathIn = REPATH_EVERY;
				this.path = findPath(
					this.level,
					this.level.cellOf( position.x, position.z ),
					this.level.cellOf( target[ 0 ], target[ 1 ] )
				);

			}

			if ( this.path !== null && this.path.length > 0 ) {

				const [ wx, wz ] = this.path[ 0 ];
				const dx = wx - position.x;
				const dz = wz - position.z;
				const step = Math.hypot( dx, dz );

				if ( step < 0.25 ) {

					this.path.shift();

				} else {

					position.x += ( dx / step ) * speed * delta;
					position.z += ( dz / step ) * speed * delta;
					this._facing.set( dx / step, 0, dz / step );

				}

			}

		}

		// Cazando encara al jugador; si no, mira hacia donde camina. Un bicho que
		// te mira fijo mientras patrulla delata que el juego sabe donde estas.
		if ( this.state === 'hunting' ) {

			this._target.set( playerPosition.x, 0, playerPosition.z );

		} else {

			this._target.copy( position ).add( this._facing );
			this._target.y = 0;

		}

		this.mesh.lookAt( this._target );

		this._animate( delta, speed );

		// El retumbe sube con la cercania, no con el estado: se oye venir.
		const dread = Math.max( 0, 1 - this.distance / config.loseDistance );
		this.audio.setDread( dread * dread );

		return this.distance < this.config.catchDistance;

	}

	/**
	 * Ciclo de marcha procedural. La fase avanza por DISTANCIA recorrida, no por
	 * tiempo: si avanzara por tiempo, al pasar de acechar a cazar las piernas
	 * mantendrian la cadencia mientras el cuerpo acelera, y patinaria.
	 */
	_animate( delta, speed ) {

		const rig = this.mesh.userData.rig;

		this.phase += speed * delta * 1.9;

		// Una pisada por cada medio ciclo, disparada por la fase y no por un
		// temporizador: asi el sonido cae exactamente cuando el pie toca.
		const stepIndex = Math.floor( this.phase / Math.PI );
		if ( stepIndex !== this._lastStepPhase ) {

			this._lastStepPhase = stepIndex;
			if ( this.voice !== null ) this.voice.step();

		}

		const swing = Math.sin( this.phase );
		const counter = Math.sin( this.phase + Math.PI );

		rig.legL.rotation.x = swing * 0.55;
		rig.legR.rotation.x = counter * 0.55;

		// Los brazos van al reves que las piernas, y mas flojos: cuelgan.
		rig.armL.rotation.x = counter * 0.33;
		rig.armR.rotation.x = swing * 0.33;
		rig.armL.rotation.z = 0.06;
		rig.armR.rotation.z = - 0.06;

		// El cuerpo sube dos veces por zancada, no una.
		rig.torso.position.y = 1.41 + Math.abs( Math.sin( this.phase ) ) * 0.035;
		rig.torso.rotation.z = swing * 0.03;

		// La cabeza se queda atras un instante: el cuello largo tiene inercia.
		rig.headPivot.rotation.z = counter * 0.05;
		rig.headPivot.rotation.x = Math.sin( this.phase * 2 ) * 0.025;

		// Los ojos se encienden al pasar a cazar. Es el aviso que el jugador
		// puede leer: antes de que acelere, ya se nota que te vio.
		const hunting = this.state === 'hunting';

		if ( hunting !== this.noticed ) {

			this.noticed = hunting;
			if ( hunting ) this.audio.noticed();

		}

		rig.eyeMaterial.color.lerp( hunting ? EYE_LIT : EYE_DIM, 1 - Math.exp( - 6 * delta ) );

	}

}
