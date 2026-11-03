import * as THREE from 'three/webgpu';
import { pass, vec4, vec2, float } from 'three/tsl';
import { film } from 'three/addons/tsl/display/FilmNode.js';
import { vignette } from 'three/addons/tsl/display/CRT.js';
import { chromaticAberration } from 'three/addons/tsl/display/ChromaticAberrationNode.js';

/**
 * Cadena de post. `RenderPipeline` reemplazo a `PostProcessing` en r183 — la
 * clase vieja todavia existe pero solo extiende a esta y avisa por consola.
 *
 * Tres efectos, todos muy por debajo de donde se notarian solos. El objetivo no
 * es que se vean: es que el cuadro deje de parecer un render limpio. Un pasillo
 * mono-amarillo perfectamente nitido se lee como viewport de editor; con grano
 * y caida en los bordes se lee como una camara barata en un lugar real.
 */
export function createPost( renderer, scene, camera ) {

	const pipeline = new THREE.RenderPipeline( renderer );

	const scenePass = pass( scene, camera );

	// BISECCION: salida cruda del pase de escena.
	const stage = new URLSearchParams( location.search ).get( 'post' ) || 'all';
	if ( stage === 'raw' ) { pipeline.outputNode = scenePass; return pipeline; }

	// Aberracion muy leve: separa apenas los canales hacia los bordes, que es
	// lo que hace una lente mala. Mas que esto y se vuelve un efecto.
	// El centro va EXPLICITO. El JSDoc dice "if null, uses screen center" pero la
	// implementacion no tiene ese fallback: usa this.centerNode tal cual en
	// uv.sub(center), asi que con null muestrea fuera de la textura y da negro.
	//
	// Fuerza 0.07 y scale 1.0, no los defaults. El escalado de canal es
	// 1 +- scale * 0.02 * strength, asi que con 0.22 y scale 1.1 la diferencia
	// llega a 0.5%: en los bordes de pantalla son varios pixeles de franja roja
	// y cian, y se lee como efecto en vez de como lente.
	let output = chromaticAberration( scenePass, 0.07, vec2( 0.5, 0.5 ), 1.0 );

	// Grano. Se mueve con el tiempo, asi que tambien rompe el banding de los
	// degrades suaves del lightmap en las paredes grandes.
	if ( stage === 'ca' ) { pipeline.outputNode = output; return pipeline; }

	output = film( output, float( 0.13 ) );

	if ( stage === 'film' ) { pipeline.outputNode = output; return pipeline; }

	// La viñeta toma y devuelve vec3: hay que desarmar y rearmar el vec4.
	const withVignette = vignette( output.rgb, float( 0.55 ), float( 0.42 ) );

	pipeline.outputNode = vec4( withVignette, output.a );

	return pipeline;

}
