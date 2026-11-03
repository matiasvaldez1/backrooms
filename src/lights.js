import * as THREE from 'three/webgpu';
import { ClusteredLighting } from 'three/addons/lighting/ClusteredLighting.js';
import { randInt } from './rng.js';

// Medidas fisicas del artefacto. Si un nivel usa otro tipo de luminaria, lo que
// cambia no son estos numeros sino el modulo entero.
const PANEL_W = 1.25;
const PANEL_D = 0.6;

/**
 * Parpadeo de tubo gastado: casi siempre encendido, con caidas bruscas y un
 * temblor de alta frecuencia encima. Un seno suave se lee como "respirando",
 * que es justo lo que un fluorescente roto no hace.
 */
function flickerAt( time, offset ) {

	const slow = Math.sin( time * 13.3 + offset ) * 0.5 + 0.5;
	if ( slow < 0.11 ) return 0;                      // apagon corto
	if ( slow < 0.17 ) return 0.35;                   // reenganche
	return 0.86 + 0.14 * Math.sin( time * 51 + offset * 3.1 );

}

/**
 * @param {THREE.WebGPURenderer} renderer
 * @param {THREE.Scene} scene
 * @param {object} level
 * @param {() => number} rand
 */
export function createLighting( renderer, scene, level, rand ) {

	const config = level.definition.lighting;
	const { grid, wallHeight, centerOf } = level.dims;

	const panelY = wallHeight - 0.02;   // apenas bajo el cielorraso
	const lightY = wallHeight - 0.12;

	// Forward+ clustered: el frustum se parte en una grilla 3D y cada fragmento
	// solo evalua las luces que realmente lo alcanzan. Sin esto, 60 point lights
	// sobre cada fragmento del casco es inviable.
	renderer.lighting = new ClusteredLighting();

	// --- donde van los artefactos ---------------------------------------------

	const spots = [];

	for ( let cz = 2; cz < grid - 2; cz += config.spacing ) {

		for ( let cx = 2; cx < grid - 2; cx += config.spacing ) {

			const [ x, z ] = centerOf( cx, cz );
			if ( level.isSolid( x, z ) ) continue;
			spots.push( { x, z } );

		}

	}

	// Zonas muertas: sectores enteros sin luz, no tubos sueltos salteados.
	// Es la diferencia entre "mantenimiento atrasado" y "sal y pimienta".
	const deadZones = [];
	for ( let i = 0; i < config.deadZones; i ++ ) {

		const seed = spots[ randInt( rand, 0, spots.length - 1 ) ];
		deadZones.push( { x: seed.x, z: seed.z, r: 7 + rand() * 5 } );

	}

	for ( const spot of spots ) {

		// El indice del sector importa: es la unidad que un tablero enciende.
		spot.sector = deadZones.findIndex(
			zone => Math.hypot( spot.x - zone.x, spot.z - zone.z ) < zone.r
		);

		// Los muertos sueltos (fuera de todo sector) no los arregla ningun tablero.
		spot.dead = spot.sector >= 0 || rand() < config.strayDeadChance;
		spot.flickers = ! spot.dead && rand() < config.flickerChance;
		spot.offset = rand() * Math.PI * 2;
		spot.ramp = spot.dead ? 0 : 1;
		spot.rampDelay = rand() * 0.9;   // los tubos no arrancan todos juntos

	}

	const steady = spots.filter( s => ! s.dead && ! s.flickers );
	const dead = spots.filter( s => s.dead );
	const flickering = spots.filter( s => s.flickers );

	// --- paneles --------------------------------------------------------------

	// El quad nace en XY mirando +Z; rotado 90° en X apunta a -Y, o sea al piso.
	const panelGeometry = new THREE.PlaneGeometry( PANEL_W, PANEL_D );
	panelGeometry.rotateX( Math.PI / 2 );

	const group = new THREE.Group();
	group.name = 'fluorescentes';

	const makeInstanced = ( list, color ) => {

		const material = new THREE.MeshBasicNodeMaterial( { color, fog: false } );
		const mesh = new THREE.InstancedMesh( panelGeometry, material, Math.max( list.length, 1 ) );
		mesh.count = list.length;
		mesh.frustumCulled = false;

		const matrix = new THREE.Matrix4();
		list.forEach( ( spot, i ) => {

			matrix.makeTranslation( spot.x, panelY, spot.z );
			mesh.setMatrixAt( i, matrix );

		} );

		mesh.instanceMatrix.needsUpdate = true;
		return mesh;

	};

	// Instanciados para los que no cambian. Los que parpadean van como Mesh
	// sueltos: son un puñado y asi cada uno tiene su propio material que animar,
	// sin pelearse con instanceColor sobre un node material.
	group.add( makeInstanced( steady, config.aliveEmissive ) );
	group.add( makeInstanced( dead, config.deadEmissive ) );

	for ( const spot of flickering ) {

		const material = new THREE.MeshBasicNodeMaterial( { color: config.aliveEmissive, fog: false } );
		const mesh = new THREE.Mesh( panelGeometry, material );
		mesh.position.set( spot.x, panelY, spot.z );
		spot.panelMaterial = material;
		group.add( mesh );

	}

	scene.add( group );

	// --- luces ----------------------------------------------------------------

	// Todas se crean ahora, aunque esten muertas, y arrancan en intensity 0.
	// Agregar o quitar una luz en runtime recompila todos los materiales
	// iluminados: el hitch caeria justo cuando el jugador entra a una sala.
	// Ninguna proyecta sombra — son 6 pasadas de depth cada una.
	const lights = [];

	for ( const spot of spots ) {

		const light = new THREE.PointLight( config.color, 0, config.range );
		light.position.set( spot.x, lightY, spot.z );
		light.castShadow = false;
		scene.add( light );

		spot.light = light;
		lights.push( light );

		if ( ! spot.dead ) light.intensity = config.intensity;

	}

	const sectors = deadZones.map( ( zone, i ) => ( {
		id: i,
		x: zone.x,
		z: zone.z,
		radius: zone.r,
		restored: false,
		restoringFor: - 1,
		spots: spots.filter( spot => spot.sector === i )
	} ) ).filter( sector => sector.spots.length > 0 );

	const _color = new THREE.Color();
	const liveSpots = spots;

	return {
		sectors,

		/**
		 * Luz local 0..1 segun el tubo encendido mas cercano. La consultan el
		 * zumbido y el bicho — el bicho se envalentona donde esto da bajo.
		 */
		lightLevelAt( x, z ) {

			let nearest = Infinity;

			for ( const spot of liveSpots ) {

				if ( spot.light.intensity <= 0.5 ) continue;
				const d = Math.hypot( spot.x - x, spot.z - z );
				if ( d < nearest ) nearest = d;

			}

			return Math.max( 0, 1 - nearest / 12 );

		},

		/** Levanta el tablero de un sector. La rampa la maneja update(). */
		restoreSector( id ) {

			const sector = sectors.find( s => s.id === id );
			if ( sector === undefined || sector.restored ) return false;

			sector.restored = true;
			sector.restoringFor = 0;

			for ( const spot of sector.spots ) spot.dead = false;

			return true;

		},

		get restoredCount() {

			return sectors.filter( s => s.restored ).length;

		},

		group,
		lights,
		// Las vivas van al bake como luz directa.
		bakeLights: spots.filter( s => ! s.dead ).map( s => s.light ),
		// Estas NO se hornean: cambian en runtime, asi que el casco las sigue
		// viendo en vivo a traves de material.lightsNode.
		flickering: flickering.map( s => s.light ),

		// Los tubos que un tablero puede devolver. Estaban muertos al momento de
		// hornear, asi que aportaron CERO al lightmap — por eso sumarlos en vivo
		// no cuenta dos veces. Y por eso tienen que estar: sin ellos en el
		// lightsNode del casco, levantar un tablero no ilumina nada.
		sectorLights: spots.filter( spot => spot.sector >= 0 ).map( spot => spot.light ),
		stats: {
			total: spots.length,
			vivas: steady.length,
			muertas: dead.length,
			parpadeando: flickering.length
		},

		/**
		 * @param {number} elapsed tiempo de juego acumulado
		 * @param {number} delta
		 * @param {?THREE.Vector3} entityPosition para la estela de parpadeo
		 */
		update( elapsed, delta, entityPosition = null ) {

			// Rampa de encendido. No es instantanea a proposito: es LA recompensa
			// de la mision y tiene que verse llegar, tubo por tubo.
			for ( const sector of sectors ) {

				if ( sector.restoringFor < 0 ) continue;

				sector.restoringFor += delta;

				let done = true;

				for ( const spot of sector.spots ) {

					const t = ( sector.restoringFor - spot.rampDelay ) / 0.7;

					if ( t < 0 ) { done = false; continue; }
					if ( t < 1 ) done = false;

					// Tartamudeo de arranque de balasto antes de quedar firme.
					const settle = Math.min( 1, t );
					const stutter = t < 1 ? ( Math.sin( t * 34 ) > - 0.3 ? 1 : 0.2 ) : 1;
					spot.ramp = settle * stutter;

					spot.light.intensity = config.intensity * spot.ramp;
					_color.setHex( config.aliveEmissive ).multiplyScalar( 0.1 + spot.ramp * 0.9 );
					if ( spot.panelMaterial ) spot.panelMaterial.color.copy( _color );

				}

				if ( done ) sector.restoringFor = - 1;

			}

			// Los que parpadean de fabrica.
			for ( const spot of flickering ) {

				const value = flickerAt( elapsed, spot.offset );
				spot.light.intensity = config.intensity * value;
				_color.setHex( config.aliveEmissive ).multiplyScalar( 0.12 + value * 0.88 );
				spot.panelMaterial.color.copy( _color );

			}

			// Estela del bicho: los tubos titilan a su paso. Es la señal principal
			// de que se acerca, y es diegetica — ves parpadear una hilera por un
			// pasillo al que no podes ver.
			if ( entityPosition === null ) return;

			for ( const spot of liveSpots ) {

				if ( spot.dead || spot.ramp < 1 ) continue;

				const d = Math.hypot( spot.x - entityPosition.x, spot.z - entityPosition.z );

				if ( d > 6 ) {

					if ( spot.disturbed ) {

						spot.disturbed = false;
						if ( ! spot.flickers ) spot.light.intensity = config.intensity;

					}

					continue;

				}

				if ( spot.flickers ) continue;   // ya titila solo

				spot.disturbed = true;
				const strength = 1 - d / 6;
				const value = 1 - strength * ( Math.sin( elapsed * 41 + spot.offset ) > 0.2 ? 0.85 : 0.05 );
				spot.light.intensity = config.intensity * value;

			}

		}
	};

}
