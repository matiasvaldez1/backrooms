import * as THREE from 'three/webgpu';

/**
 * Tableros y salida.
 *
 * El contrato del bucle: el jugador levanta tableros para devolverle la luz al
 * piso y abrir la salida, mientras algo que se envalentona en la oscuridad y lo
 * oye correr genera riesgo. El exito da territorio iluminado permanente y un
 * bicho mas cauto; el fracaso cuesta la posicion, no el progreso.
 *
 * Los tableros son los unicos objetos del juego a proposito: son los unicos que
 * cambian el estado del mundo. Agregar coleccionables que solo suman un contador
 * seria llenar una cuota.
 */

const REACH = 2.2;               // distancia para poder interactuar
const EXIT_REACH = 1.8;
const PANEL_Y = 1.25;

/** Direcciones de vecino, para encontrar una pared contra la cual montar algo. */
const NEIGHBOURS = [ [ 1, 0 ], [ - 1, 0 ], [ 0, 1 ], [ 0, - 1 ] ];

/**
 * Busca una celda abierta pegada a una pared. Devuelve el punto de montaje y la
 * normal hacia la que mira. Sin esto los tableros quedarian flotando en el aire.
 */
function findWallMount( level, candidates, rand ) {

	const { cell } = level.dims;
	const shuffled = candidates.slice();

	// Fisher-Yates con el RNG con seed, no con Math.random.
	for ( let i = shuffled.length - 1; i > 0; i -- ) {

		const j = Math.floor( rand() * ( i + 1 ) );
		[ shuffled[ i ], shuffled[ j ] ] = [ shuffled[ j ], shuffled[ i ] ];

	}

	for ( const [ x, z ] of shuffled ) {

		for ( const [ dx, dz ] of NEIGHBOURS ) {

			const wallX = x + dx * cell;
			const wallZ = z + dz * cell;

			if ( ! level.isSolid( wallX, wallZ ) ) continue;

			return {
				// Pegado a la pared pero sin atravesarla.
				x: x + dx * ( cell / 2 - 0.1 ),
				z: z + dz * ( cell / 2 - 0.1 ),
				// Mira hacia la celda abierta, o sea al reves de la pared.
				facing: Math.atan2( - dx, - dz ),
				standX: x,
				standZ: z
			};

		}

	}

	return null;

}

function makeBreakerMesh() {

	const group = new THREE.Group();

	const box = new THREE.Mesh(
		new THREE.BoxGeometry( 0.42, 0.56, 0.12 ),
		new THREE.MeshStandardNodeMaterial( { color: 0x6d6a5c, roughness: 0.7, metalness: 0.4 } )
	);
	box.castShadow = true;

	// La palanca: roja abajo cuando esta bajo, verde arriba cuando esta puesto.
	const lever = new THREE.Mesh(
		new THREE.BoxGeometry( 0.1, 0.16, 0.06 ),
		new THREE.MeshBasicNodeMaterial( { color: 0xd04a2e, fog: false } )
	);
	lever.position.set( 0, - 0.13, 0.08 );

	group.add( box, lever );
	group.userData.lever = lever;
	return group;

}

function makeExitMesh() {

	const group = new THREE.Group();

	const frame = new THREE.Mesh(
		new THREE.BoxGeometry( 1.15, 2.15, 0.16 ),
		new THREE.MeshStandardNodeMaterial( { color: 0x2a2822, roughness: 0.85, metalness: 0.2 } )
	);
	frame.position.y = 1.07;
	frame.castShadow = true;

	// La rendija de luz bajo la puerta: lo unico que la delata estando cerrada.
	const seam = new THREE.Mesh(
		new THREE.PlaneGeometry( 0.95, 1.85 ),
		new THREE.MeshBasicNodeMaterial( { color: 0x1a1a14, fog: false } )
	);
	seam.position.set( 0, 1.0, 0.09 );

	group.add( frame, seam );
	group.userData.seam = seam;
	return group;

}

const SEALED = new THREE.Color( 0x1a1a14 );
const OPEN = new THREE.Color( 0xfff0c0 );

/**
 * @param {THREE.Scene} scene
 * @param {object} level
 * @param {object} lighting
 * @param {() => number} rand
 * @param {[number, number]} spawn donde arranca el jugador, para alejar la salida
 */
export function createMission( scene, level, lighting, rand, spawn ) {

	const group = new THREE.Group();
	group.name = 'mision';

	// --- tableros, uno por sector -------------------------------------------

	const breakers = [];

	for ( const sector of lighting.sectors ) {

		// Candidatas: celdas abiertas dentro del sector.
		const inside = level.spawnPoints.filter(
			( [ x, z ] ) => Math.hypot( x - sector.x, z - sector.z ) < sector.radius
		);

		const mount = findWallMount( level, inside.length > 0 ? inside : level.spawnPoints, rand );
		if ( mount === null ) continue;

		const mesh = makeBreakerMesh();
		mesh.position.set( mount.x, PANEL_Y, mount.z );
		mesh.rotation.y = mount.facing;
		group.add( mesh );

		breakers.push( { sector, mesh, x: mount.x, z: mount.z, up: false } );

	}

	// --- salida, lo mas lejos posible del spawn ------------------------------

	let farthest = null;
	let farthestDistance = - 1;

	for ( const point of level.spawnPoints ) {

		const d = Math.hypot( point[ 0 ] - spawn[ 0 ], point[ 1 ] - spawn[ 1 ] );
		if ( d > farthestDistance ) { farthestDistance = d; farthest = point; }

	}

	const exitMount = findWallMount( level, [ farthest ], rand )
		|| findWallMount( level, level.spawnPoints, rand );

	const exitMesh = makeExitMesh();
	exitMesh.position.set( exitMount.x, 0, exitMount.z );
	exitMesh.rotation.y = exitMount.facing;
	group.add( exitMesh );

	scene.add( group );

	const exit = { mesh: exitMesh, x: exitMount.x, z: exitMount.z, open: false };
	const _color = new THREE.Color();

	return {
		group,
		breakers,
		exit,
		state: 'running',

		get total() { return breakers.length; },
		get done() { return breakers.filter( b => b.up ).length; },
		get allUp() { return breakers.length > 0 && breakers.every( b => b.up ); },

		/** El tablero o la salida al alcance, si hay alguno. */
		focus( position ) {

			if ( this.allUp && Math.hypot( position.x - exit.x, position.z - exit.z ) < EXIT_REACH ) {

				return { kind: 'exit' };

			}

			for ( const breaker of breakers ) {

				if ( breaker.up ) continue;
				if ( Math.hypot( position.x - breaker.x, position.z - breaker.z ) < REACH ) {

					return { kind: 'breaker', breaker };

				}

			}

			return null;

		},

		/** @returns {?string} que paso, para que el HUD y el audio reaccionen */
		interact( position ) {

			const target = this.focus( position );
			if ( target === null ) return null;

			if ( target.kind === 'exit' ) {

				this.state = 'won';
				return 'won';

			}

			target.breaker.up = true;
			target.breaker.mesh.userData.lever.position.y = 0.13;
			target.breaker.mesh.userData.lever.material.color.setHex( 0x4ad06a );
			lighting.restoreSector( target.breaker.sector.id );

			return this.allUp ? 'last' : 'breaker';

		},

		update( elapsed ) {

			// La puerta deja de ser parte de la pared recien cuando se abre.
			const lit = this.allUp;

			if ( lit !== exit.open ) {

				exit.open = lit;

			}

			if ( exit.open ) {

				const pulse = 0.72 + Math.sin( elapsed * 2.4 ) * 0.28;
				_color.copy( OPEN ).multiplyScalar( pulse );
				exitMesh.userData.seam.material.color.copy( _color );

			} else {

				exitMesh.userData.seam.material.color.copy( SEALED );

			}

		}
	};

}
