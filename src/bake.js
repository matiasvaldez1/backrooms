import * as THREE from 'three/webgpu';
import { lights } from 'three/tsl';
import { unwrapUVs } from 'three/addons/utils/unwrapUVs.js';
import { LightMapper } from 'three/addons/lighting/LightMapper.js';
import { LightProbeGrid } from 'three/addons/lighting/LightProbeGrid.js';
import { lightProbeGridIrradiance } from 'three/addons/tsl/lighting/LightProbeGridNode.js';

/**
 * Hornea la iluminacion indirecta del casco estatico.
 *
 * El amarillo enfermizo del Backrooms NO es el color de las paredes: es luz de
 * los tubos rebotando en paredes amarillas y volviendo. Eso es GI indirecta, y
 * ninguna cantidad de point lights directas lo produce.
 *
 * Reparto de trabajo, elegido para que nada se cuente dos veces:
 *   - lightmap  → los 49 tubos fijos, directa e indirecta, sobre el casco
 *   - runtime   → la linterna y los 6 tubos que parpadean, sobre el casco
 *   - runtime   → los 78 tubos completos sobre lo que se mueve (la entidad)
 *
 * El casco se desengancha de los tubos fijos con `material.lightsNode`, que es
 * la unica forma de filtrar luces por material y existe solo bajo WebGPURenderer.
 * Sin eso, los tubos fijos aportarian dos veces: una horneada y otra en vivo.
 */
export async function bakeGI( renderer, scene, level, lighting, flashlight, options = {} ) {

	const {
		atlas = 4096,
		samples = 128,         // techo duro de 256: se acumulan en half float
		probesXZ = 18,
		probesY = 3,
		bounces = 2,
		onStep = () => {}
	} = options;

	const report = { atlas, samples };

	// --- 1. UVs de lightmap --------------------------------------------------

	onStep( 'uvs' );
	await nextFrame();

	const previousGeometries = level.bakeable.map( mesh => mesh.geometry );

	const t0 = performance.now();
	// Trabaja en world space: las transforms tienen que estar finales ya.
	const info = unwrapUVs( level.group, {
		attribute: 'uv1',
		mode: 'lightmap',
		resolution: atlas,
		padding: 4            // minimo 3: el resolve rellena 2 texels alrededor
	} );
	report.unwrapMs = Math.round( performance.now() - t0 );

	if ( info === null ) {

		report.error = 'unwrapUVs devolvio null: los charts no entran en el atlas';
		return report;

	}

	report.charts = info.charts.length;
	// density en packCharts es chart.width(metros) * density = pixeles, asi que
	// texelsPerUnit ya viene en texels por metro LINEAL. No sacarle raiz.
	report.texelsPorMetro = +info.texelsPerUnit.toFixed( 1 );
	report.warnings = info.warnings;

	// unwrapUVs REEMPLAZA mesh.geometry por una nueva y no dispone la vieja.
	for ( const geometry of previousGeometries ) {

		if ( ! level.bakeable.some( mesh => mesh.geometry === geometry ) ) geometry.dispose();

	}

	// --- 2. Grilla de probes -------------------------------------------------

	onStep( 'probes' );
	await nextFrame();

	const { size, wallHeight } = level.dims;
	const grid = new LightProbeGrid( size, wallHeight, size, probesXZ, probesY, probesXZ );
	grid.position.set( 0, wallHeight / 2, 0 );
	scene.add( grid );

	const t1 = performance.now();
	grid.bake( renderer, scene, { cubemapSize: 16, near: 0.1, far: 45, bounces } );
	report.probesMs = Math.round( performance.now() - t1 );
	report.probes = probesXZ * probesY * probesXZ;

	// --- 3. Lightmap ---------------------------------------------------------

	onStep( 'lightmap' );
	await nextFrame();

	// Los tubos fijos entran como luz directa; la grilla aporta el rebote.
	const steady = lighting.bakeLights.filter( light => ! lighting.flickering.includes( light ) );

	const mapper = new LightMapper(
		renderer,
		atlas,
		( position, normal ) => lightProbeGridIrradiance( grid, position, normal ),
		{ lights: steady }
	);

	mapper.addObjects( level.bakeable );

	const t2 = performance.now();
	mapper.update( samples );
	report.lightmapMs = Math.round( performance.now() - t2 );

	// --- 4. Aplicar ----------------------------------------------------------

	// La grilla sale de la escena: es un Light y aplicaria su irradiancia a todo
	// material node automaticamente, encima del lightmap que acabamos de hornear.
	scene.remove( grid );

	// El casco solo ve lo que NO esta horneado: la linterna, los tubos que
	// titilan, y los tubos de sector que un tablero puede devolver. Estos
	// ultimos estaban apagados durante el bake, asi que su aporte en vivo es
	// puramente aditivo.
	const runtimeLights = [ flashlight.light, ...lighting.flickering, ...lighting.sectorLights ];

	// IMPORTANTE: el nodo se pide al sistema de iluminacion, no se arma con
	// lights(). Un LightsNode plano saca al material del camino clustered y lo
	// manda a evaluar las 26 luces por fragmento en un loop forward — medido:
	// 52 fps contra 121. Y sobre el casco, que cubre toda la pantalla, eso es
	// perder exactamente aquello para lo que existe ClusteredLighting.
	const lightsNode = typeof renderer.lighting.createNode === 'function'
		? renderer.lighting.createNode( runtimeLights )
		: lights( runtimeLights );

	for ( const mesh of level.bakeable ) {

		mesh.material.lightMap = mapper.texture;
		mesh.material.lightMapIntensity = 1;
		mesh.material.lightsNode = lightsNode;
		mesh.material.needsUpdate = true;

	}

	report.lucesEnVivoSobreElCasco = runtimeLights.length;
	report.lucesDeSector = lighting.sectorLights.length;
	report.lucesHorneadas = steady.length;
	report.totalMs = report.unwrapMs + report.probesMs + report.lightmapMs;
	report.ok = true;

	return report;

}

function nextFrame() {

	return new Promise( resolve => requestAnimationFrame( resolve ) );

}
