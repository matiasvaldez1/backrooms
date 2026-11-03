import * as THREE from 'three/webgpu';

/**
 * Constructor generico de niveles.
 *
 * No hay ni una constante de modulo aca a proposito: las dimensiones viven en el
 * objeto de nivel que devuelve `buildLevel`, no en el scope del archivo. Mientras
 * estuvieron en el modulo, dos niveles de tamaños distintos no podian coexistir
 * — toda la aritmetica mundo-celda estaba horneada en el import.
 *
 * El greedy meshing y el recorte de region son genericos: sirven para cualquier
 * planta. Lo especifico de cada nivel (como se genera esa planta, con que
 * materiales, con que luz y con que criatura) vive en `levels/*.js`.
 */

/** Deriva las medidas y los conversores mundo-celda de una definicion. */
function makeDims( { grid, cell, wallHeight } ) {

	const size = grid * cell;
	const half = size / 2;

	return {
		grid, cell, wallHeight, size, half,
		index: ( x, z ) => z * grid + x,
		// El origen del mundo cae en el centro del nivel.
		cellOf: ( worldX, worldZ ) => [
			Math.floor( ( worldX + half ) / cell ),
			Math.floor( ( worldZ + half ) / cell )
		],
		centerOf: ( cx, cz ) => [
			cx * cell - half + cell / 2,
			cz * cell - half + cell / 2
		]
	};

}

/**
 * Se queda con la region abierta mas grande y rellena el resto.
 * Espacio inalcanzable seria geometria y texels de lightmap tirados.
 */
function keepLargestRegion( solid, dims ) {

	const { grid, index } = dims;
	const seen = new Uint8Array( grid * grid );
	let best = [];

	for ( let z = 1; z < grid - 1; z ++ ) {

		for ( let x = 1; x < grid - 1; x ++ ) {

			const start = index( x, z );
			if ( solid[ start ] || seen[ start ] ) continue;

			const region = [];
			const queue = [ start ];
			seen[ start ] = 1;

			while ( queue.length > 0 ) {

				const current = queue.pop();
				region.push( current );

				const cx = current % grid;
				const cz = ( current - cx ) / grid;

				for ( const [ dx, dz ] of [ [ 1, 0 ], [ - 1, 0 ], [ 0, 1 ], [ 0, - 1 ] ] ) {

					const nx = cx + dx;
					const nz = cz + dz;
					if ( nx < 0 || nz < 0 || nx >= grid || nz >= grid ) continue;

					const neighbour = index( nx, nz );
					if ( solid[ neighbour ] || seen[ neighbour ] ) continue;

					seen[ neighbour ] = 1;
					queue.push( neighbour );

				}

			}

			if ( region.length > best.length ) best = region;

		}

	}

	const keep = new Set( best );
	for ( let i = 0; i < solid.length; i ++ ) {

		if ( ! solid[ i ] && ! keep.has( i ) ) solid[ i ] = 1;

	}

	return best;

}

// --- construccion de geometria ---------------------------------------------

const createSurface = () => ( { position: [], normal: [], uv: [], index: [], quads: 0 } );

/**
 * Empuja un quad. v0..v3 en CCW vistos desde el lado de la normal.
 * Las UV se tilean por metro para que la textura no se estire en tiradas largas.
 */
function pushQuad( surface, v0, v1, v2, v3, normal, spanU, spanV ) {

	const base = surface.position.length / 3;

	for ( const v of [ v0, v1, v2, v3 ] ) surface.position.push( v[ 0 ], v[ 1 ], v[ 2 ] );
	for ( let i = 0; i < 4; i ++ ) surface.normal.push( normal[ 0 ], normal[ 1 ], normal[ 2 ] );

	surface.uv.push( 0, 0, spanU, 0, spanU, spanV, 0, spanV );
	surface.index.push( base, base + 1, base + 2, base, base + 2, base + 3 );
	surface.quads ++;

}

function toGeometry( surface ) {

	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute( 'position', new THREE.Float32BufferAttribute( surface.position, 3 ) );
	geometry.setAttribute( 'normal', new THREE.Float32BufferAttribute( surface.normal, 3 ) );
	geometry.setAttribute( 'uv', new THREE.Float32BufferAttribute( surface.uv, 2 ) );
	geometry.setIndex( surface.index );
	geometry.computeBoundingSphere();
	return geometry;

}

/**
 * Greedy meshing de las caras de pared.
 *
 * No es optimizacion prematura, es requisito del bake: en modo lightmap unwrapUVs
 * solo une caras cuyas normales caen dentro de ~48 grados, asi que cada cara de
 * una caja axis-aligned termina siendo su propio chart. Mil ochocientos charts
 * diminutos no entran en el atlas. Una tirada de 14 celdas tiene que salir como
 * UN quad de 28m, no como 14 cajas.
 */
function buildWalls( solid, dims ) {

	const { grid, cell, wallHeight, half, index } = dims;
	const surface = createSurface();

	// +X y -X: para cada columna x se barre z juntando celdas consecutivas que
	// tengan vecino abierto del mismo lado.
	for ( let x = 0; x < grid; x ++ ) {

		for ( const dir of [ 1, - 1 ] ) {

			let runStart = - 1;

			for ( let z = 0; z <= grid; z ++ ) {

				const inside = z < grid
					&& solid[ index( x, z ) ] === 1
					&& ( x + dir < 0 || x + dir >= grid || solid[ index( x + dir, z ) ] === 0 );

				if ( inside && runStart === - 1 ) runStart = z;

				if ( ! inside && runStart !== - 1 ) {

					const z0 = runStart * cell - half;
					const z1 = z * cell - half;
					const wx = ( dir === 1 ? x + 1 : x ) * cell - half;
					const spanU = ( z1 - z0 ) / 2;
					const spanV = 1;   // sin tileo vertical: el rodapie va una sola vez

					if ( dir === 1 ) {

						pushQuad( surface,
							[ wx, 0, z1 ], [ wx, 0, z0 ], [ wx, wallHeight, z0 ], [ wx, wallHeight, z1 ],
							[ 1, 0, 0 ], spanU, spanV );

					} else {

						pushQuad( surface,
							[ wx, 0, z0 ], [ wx, 0, z1 ], [ wx, wallHeight, z1 ], [ wx, wallHeight, z0 ],
							[ - 1, 0, 0 ], spanU, spanV );

					}

					runStart = - 1;

				}

			}

		}

	}

	// +Z y -Z: espejo del anterior, barriendo x.
	for ( let z = 0; z < grid; z ++ ) {

		for ( const dir of [ 1, - 1 ] ) {

			let runStart = - 1;

			for ( let x = 0; x <= grid; x ++ ) {

				const inside = x < grid
					&& solid[ index( x, z ) ] === 1
					&& ( z + dir < 0 || z + dir >= grid || solid[ index( x, z + dir ) ] === 0 );

				if ( inside && runStart === - 1 ) runStart = x;

				if ( ! inside && runStart !== - 1 ) {

					const x0 = runStart * cell - half;
					const x1 = x * cell - half;
					const wz = ( dir === 1 ? z + 1 : z ) * cell - half;
					const spanU = ( x1 - x0 ) / 2;
					const spanV = 1;

					if ( dir === 1 ) {

						pushQuad( surface,
							[ x0, 0, wz ], [ x1, 0, wz ], [ x1, wallHeight, wz ], [ x0, wallHeight, wz ],
							[ 0, 0, 1 ], spanU, spanV );

					} else {

						pushQuad( surface,
							[ x1, 0, wz ], [ x0, 0, wz ], [ x0, wallHeight, wz ], [ x1, wallHeight, wz ],
							[ 0, 0, - 1 ], spanU, spanV );

					}

					runStart = - 1;

				}

			}

		}

	}

	return surface;

}

/** Piso y techo en tiles grandes: pocos charts, coplanares, que es lo que el bake quiere. */
function buildSlab( dims, y, normalY, tiles, metresPerRepeat ) {

	const { size, half } = dims;
	const surface = createSurface();
	const step = size / tiles;

	for ( let tz = 0; tz < tiles; tz ++ ) {

		for ( let tx = 0; tx < tiles; tx ++ ) {

			const x0 = tx * step - half;
			const x1 = x0 + step;
			const z0 = tz * step - half;
			const z1 = z0 + step;
			const span = step / metresPerRepeat;

			if ( normalY === 1 ) {

				pushQuad( surface,
					[ x0, y, z1 ], [ x1, y, z1 ], [ x1, y, z0 ], [ x0, y, z0 ],
					[ 0, 1, 0 ], span, span );

			} else {

				pushQuad( surface,
					[ x0, y, z0 ], [ x1, y, z0 ], [ x1, y, z1 ], [ x0, y, z1 ],
					[ 0, - 1, 0 ], span, span );

			}

		}

	}

	return surface;

}

/**
 * @param {object} definition modulo de `levels/`
 * @param {() => number} rand
 * @param {{ wall: THREE.Material, floor: THREE.Material, ceiling: THREE.Material }} materials
 */
export function buildLevel( definition, rand, materials ) {

	const dims = makeDims( definition.dims );
	const surfaces = definition.surfaces;

	const solid = definition.generatePlan( rand, dims );
	const open = keepLargestRegion( solid, dims );

	const wallSurface = buildWalls( solid, dims );
	const floorSurface = buildSlab( dims, 0, 1, surfaces.floorTiles, surfaces.floorMetresPerRepeat );
	const ceilingSurface = buildSlab( dims, dims.wallHeight, - 1, surfaces.ceilingTiles, surfaces.ceilingMetresPerRepeat );

	const walls = new THREE.Mesh( toGeometry( wallSurface ), materials.wall );
	const floor = new THREE.Mesh( toGeometry( floorSurface ), materials.floor );
	const ceiling = new THREE.Mesh( toGeometry( ceilingSurface ), materials.ceiling );

	walls.name = 'walls';
	floor.name = 'floor';
	ceiling.name = 'ceiling';

	// Las sombras necesitan tres interruptores: el renderer, la luz, y las mallas.
	// Sin un solo caster el pase de sombra no renderiza nada y la shadow camera
	// nunca se actualiza. Solo las paredes proyectan.
	walls.castShadow = true;
	walls.receiveShadow = true;
	floor.receiveShadow = true;
	ceiling.receiveShadow = true;

	const group = new THREE.Group();
	group.name = definition.id;
	group.add( walls, floor, ceiling );

	const spawnPoints = open.map( i => {

		const cx = i % dims.grid;
		const cz = ( i - cx ) / dims.grid;
		return dims.centerOf( cx, cz );

	} );

	return {
		definition,
		dims,
		group,
		solid,
		// Las tres se hornean. Son Mesh planos a proposito: unwrapUVs saltea
		// InstancedMesh y BatchedMesh por completo.
		bakeable: [ walls, floor, ceiling ],
		spawnPoints,

		cellOf: dims.cellOf,
		centerOf: dims.centerOf,

		isSolid( worldX, worldZ ) {

			const [ cx, cz ] = dims.cellOf( worldX, worldZ );
			if ( cx < 0 || cz < 0 || cx >= dims.grid || cz >= dims.grid ) return true;
			return solid[ dims.index( cx, cz ) ] === 1;

		},

		stats: {
			nivel: definition.name,
			wallQuads: wallSurface.quads,
			slabQuads: floorSurface.quads + ceilingSurface.quads,
			openCells: open.length,
			totalCells: dims.grid * dims.grid
		}
	};

}
