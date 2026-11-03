import * as THREE from 'three/webgpu';

import { createRng, randInt } from './rng.js';
import { buildLevel } from './level.js';
import level0 from './levels/level0.js';
import { createMaterials } from './materials.js';
import { createLighting } from './lights.js';
import { Flashlight } from './flashlight.js';
import { Player } from './player.js';
import { AudioEngine } from './audio.js';
import { Entity } from './entity.js';
import { Feedback } from './feedback.js';
import { createMission } from './mission.js';
import { bakeGI } from './bake.js';
import { createPost } from './post.js';
import { Hud } from './hud.js';

// Cada nivel aporta su generador, su paleta, su luz y su criatura. Cambiar de
// nivel es cambiar este import, no tocar el resto del codigo.
const DEFINITION = level0;
const DEFAULT_SEED = 1987;

/**
 * Puerta de compatibilidad, antes de construir nada.
 *
 * Importa porque el fallback de WebGPU a WebGL2 es SILENCIOSO: el juego arranca,
 * renderiza bien, y corre a 9 fps. Sin este aviso, alguien sin WebGPU concluye
 * que el juego esta roto, no que su browser no lo soporta.
 *
 * @returns {boolean} true si se puede seguir
 */
async function checkSupport( forced ) {

	const panel = document.getElementById( 'unsupported' );
	const title = document.getElementById( 'unsupported-title' );
	const body = document.getElementById( 'unsupported-body' );
	const minor = document.getElementById( 'unsupported-minor' );

	const show = ( t, b, m ) => {

		title.textContent = t;
		body.innerHTML = b;
		minor.innerHTML = m || '';
		panel.classList.add( 'on' );
		document.getElementById( 'prompt' ).classList.add( 'hidden' );
		// Las cajas vacias del HUD quedarian flotando sobre el aviso.
		for ( const id of [ 'objective', 'action', 'readout' ] ) {

			document.getElementById( id ).style.display = 'none';

		}

	};

	// Sin teclado y mouse no hay juego: el pointer lock no existe en tactil y no
	// hay controles de pantalla. Mejor decirlo que dejar a alguien tocando la nada.
	if ( ! window.matchMedia( '(pointer: fine)' ).matches ) {

		show( 'Hace falta teclado y mouse',
			'Esto se camina con WASD y se mira con el mouse. En pantalla táctil no hay forma de jugarlo.',
			'Abrilo desde una computadora.' );
		return false;

	}

	if ( forced ) return true;

	let adapter = null;
	try { adapter = navigator.gpu ? await navigator.gpu.requestAdapter() : null; } catch ( e ) { adapter = null; }

	if ( adapter === null ) {

		show( 'Hace falta WebGPU',
			'Este navegador no expone WebGPU. Funciona en Chrome, Edge y Safari recientes.',
			'Igual podés <a href="?webgl">entrar en modo WebGL2</a>, pero va a ir a pocos cuadros por segundo.' );
		return false;

	}

	return true;

}

async function boot() {

	// ?webgl fuerza el fallback a WebGL2, que es lo que va a ver cualquiera sin
	// WebGPU. Hay que poder probar ESE camino, no solo el feliz.
	const forceWebGL = new URLSearchParams( location.search ).has( 'webgl' );

	if ( ! await checkSupport( forceWebGL ) ) return;

	const renderer = new THREE.WebGPURenderer( { antialias: true, forceWebGL } );

	// Antes de cualquier otro uso: render() tira si no, y el fallback a WebGL2
	// reemplaza renderer.backend justo aca.
	await renderer.init();

	renderer.setPixelRatio( Math.min( window.devicePixelRatio, 2 ) );
	renderer.setSize( window.innerWidth, window.innerHeight );
	renderer.shadowMap.enabled = true;
	renderer.shadowMap.type = THREE.PCFShadowMap;   // PCFSoftShadowMap fue removido
	renderer.toneMapping = THREE.ACESFilmicToneMapping;
	renderer.toneMappingExposure = 1.0;
	document.body.appendChild( renderer.domElement );

	const scene = new THREE.Scene();
	// El canvas de WebGPU es transparente por defecto.
	// La bruma no es atmosfera decorativa: impide ver el borde de un nivel finito
	// y hace que el lugar mienta sobre su propio tamaño.
	const fog = DEFINITION.fog;
	scene.background = new THREE.Color( fog.color );
	scene.fog = new THREE.Fog( fog.color, fog.near, fog.far );

	const camera = new THREE.PerspectiveCamera( 78, window.innerWidth / window.innerHeight, 0.1, 120 );

	const params = new URLSearchParams( location.search );
	const debug = params.has( 'debug' );

	// ?seed=N reproduce una partida exacta. El determinismo no es un lujo:
	// los hooks de verificacion dependen de el.
	const seed = Number( params.get( 'seed' ) ) || DEFAULT_SEED;
	const rand = createRng( seed );

	const materials = createMaterials( DEFINITION.palette );
	const level = buildLevel( DEFINITION, rand, materials );
	scene.add( level.group );

	const lighting = createLighting( renderer, scene, level, rand );

	const player = new Player( camera, renderer.domElement, level );

	// Necesario porque la camara tiene hijos: sin esto la linterna no se actualiza.
	scene.add( player.controls.object );

	const flashlight = new Flashlight( camera );

	const feedback = new Feedback( camera, document.getElementById( 'flash' ) );
	player.feedback = feedback;

	const audio = new AudioEngine();
	player.onFootstep = running => audio.footstep( running );

	// El listener va en la camara: es la oreja. Comparte contexto con AudioEngine.
	const listener = new THREE.AudioListener();
	camera.add( listener );

	const entity = new Entity( scene, level, lighting, rand, audio );

	// Correr te delata. El ruido es un evento discreto por paso, no un campo.
	player.onNoise = ( x, z, radius ) => entity.hear( x, z, radius );

	const blackout = document.getElementById( 'blackout' );
	const caughtLabel = document.getElementById( 'caught' );

	function respawn() {

		const point = level.spawnPoints[ randInt( rand, 0, level.spawnPoints.length - 1 ) ];
		player.teleportTo( point[ 0 ], point[ 1 ] );

	}

	let caughtFor = 0;

	function getCaught() {

		caughtFor = 2.4;

		// La pila completa de la fila "Explosion": nada de esto solo alcanza.
		feedback.hitstop( 90, 0.05 );
		feedback.addTrauma( 0.7 );
		feedback.flash( 0.8, 110 );
		feedback.punchFov( 8 );

		audio.caught();
		audio.reset();
		entity.reset();

		blackout.classList.add( 'on' );
		caughtLabel.classList.add( 'on' );

	}

	const firstSpawn = level.spawnPoints[ randInt( rand, 0, level.spawnPoints.length - 1 ) ];
	player.teleportTo( firstSpawn[ 0 ], firstSpawn[ 1 ] );

	const mission = createMission( scene, level, lighting, rand, firstSpawn );

	// --- bake de GI ----------------------------------------------------------
	//
	// Se corre despues de que el nivel y las luces existen y antes del primer
	// frame jugable. Aislado a proposito: si falla, la demo sigue con el ambient
	// plano y se reporta el motivo en vez de romperse.
	const fallback = DEFINITION.lighting.ambientFallback;
	const ambient = new THREE.AmbientLight( fallback.color, fallback.intensity );
	scene.add( ambient );

	let bakeReport = { ok: false, skipped: true };

	if ( ! new URLSearchParams( location.search ).has( 'nobake' ) ) {

		const label = document.getElementById( 'caught' );
		label.textContent = 'horneando luz\u2026';
		label.classList.add( 'on' );

		try {

			bakeReport = await bakeGI( renderer, scene, level, lighting, flashlight, {
				onStep: step => { label.textContent = step + '\u2026'; }
			} );

		} catch ( error ) {

			bakeReport = { ok: false, error: error.message };
			console.error( '[backrooms] el bake fallo, se sigue con ambient plano', error );

		}

		label.classList.remove( 'on' );
		label.textContent = 'te encontro';

		// Con GI horneada el relleno plano sobra: estaria sumando al rebote real.
		if ( bakeReport.ok ) {

			scene.remove( ambient );
			console.log( '[backrooms] bake', bakeReport );

		}

	}

	let post = null;

	if ( ! new URLSearchParams( location.search ).has( 'nopost' ) ) {

		try {

			post = createPost( renderer, scene, camera );

		} catch ( error ) {

			console.error( '[backrooms] el post fallo, se renderiza directo', error );

		}

	}

	const hud = new Hud( debug );
	hud.backend = renderer.backend.isWebGPUBackend ? 'webgpu' : 'webgl2';
	hud.bindPrompt( () => player.lock() );

	player.controls.addEventListener( 'lock', () => hud.setPromptVisible( false ) );
	player.controls.addEventListener( 'unlock', () => hud.setPromptVisible( true ) );

	window.addEventListener( 'keydown', event => {

		if ( event.code === 'KeyF' ) flashlight.toggle();

		if ( event.code === 'KeyE' && mission.state === 'running' && caughtFor <= 0 ) {

			const what = mission.interact( player.position );

			if ( what === 'won' ) hud.setWon( true );
			else if ( what !== null ) audio.noticed();   // el chasquido del tablero

		}

	} );

	// connect(document) no es opcional: con la pestaña oculta fuerza delta = 0 y
	// resetea al volver. Sin eso un alt-tab produce un delta gigante que te
	// teletransporta atravesando una pared.
	const timer = new THREE.Timer();
	timer.connect( document );

	// Tiempo de juego acumulado, no performance.now(): los efectos temporales
	// tienen que poder pausarse y ser reproducibles.
	let gameTime = 0;
	let humTick = 0;
	let relocated = false;
	let lastDuck = 1;

	// El AudioContext no existe hasta el primer gesto del usuario, asi que la voz
	// posicional de la entidad se engancha cuando el audio efectivamente arranca.
	let voiceAttached = false;

	window.addEventListener( 'resize', () => {

		camera.aspect = window.innerWidth / window.innerHeight;
		camera.updateProjectionMatrix();
		renderer.setSize( window.innerWidth, window.innerHeight );

	} );

	function frame() {

		timer.update();

		// Clamp: un hitch de carga no se integra como un salto de movimiento.
		const realDelta = Math.min( timer.getDelta(), 0.05 );

		// El feedback corre SIEMPRE en tiempo real: si se congelara junto con el
		// gameplay durante el hitstop, no habria nada que mirar en ese instante.
		feedback.update( realDelta );

		const duck = feedback.duck;
		if ( duck !== lastDuck ) { lastDuck = duck; audio.setDuck( duck ); }

		// Solo el gameplay se escala.
		const delta = realDelta * feedback.timeScale;
		gameTime += delta;

		if ( caughtFor > 0 ) {

			caughtFor -= delta;

			// Reubicar a mitad del negro, no al final: el jugador nunca ve el salto.
			if ( caughtFor <= 1.1 && ! relocated ) {

				relocated = true;
				respawn();

			}

			if ( caughtFor <= 0 ) {

				relocated = false;
				blackout.classList.remove( 'on' );
				caughtLabel.classList.remove( 'on' );

			}

		}

		if ( ! voiceAttached && audio.ready ) {

			voiceAttached = true;
			entity.setVoice( audio.attachEntityVoice( listener, entity.mesh ) );

		}

		player.update( delta, gameTime );
		lighting.update( gameTime, delta, entity.active ? entity.mesh.position : null );
		flashlight.update( delta, gameTime, Math.hypot( player.velocity.x, player.velocity.z ) );

		if ( mission.state === 'running' && caughtFor <= 0
			&& entity.update( delta, player.position ) ) getCaught();

		mission.update( gameTime );
		hud.setObjective( mission );
		hud.setAction( mission.state === 'running' && caughtFor <= 0
			? mission.focus( player.position ) : null );

		// Zumbido segun cercania al tubo vivo mas proximo. Cada 4 frames alcanza:
		// es un barrido sobre 78 luces y el oido no nota la latencia.
		humTick ++;
		if ( humTick % 4 === 0 ) {

			audio.setHumLevel( lighting.lightLevelAt( player.position.x, player.position.z ) );

		}

		if ( post !== null ) post.render();
		else renderer.render( scene, camera );

		hud.extra = `luces    <b>${ lighting.restoredCount }/${ lighting.sectors.length }</b> sectores  <b>${ lighting.stats.parpadeando }</b> parpadeando\n`
			+ `linterna <b>${ flashlight.on ? 'on' : 'off' }</b>  (F)\n`
			+ `GI       <b>${ bakeReport.ok ? bakeReport.texelsPorMetro + ' tx/m' : 'ambient plano' }</b>\n`
			+ `entidad  <b>${ entity.state }</b>`
			+ ( entity.active
				? `  a <b>${ entity.distance.toFixed( 1 ) }m</b>  luz <b>${ entity.lightLevel.toFixed( 2 ) }</b>`
				: `  en <b>${ Math.max( 0, entity.timer ).toFixed( 0 ) }s</b>` );

		hud.update( realDelta, renderer.info, player.position, level, seed );

	}

	// setAnimationLoop y no requestAnimationFrame: bajo WebGPU tambien espera el init.
	renderer.setAnimationLoop( frame );

	window.__game = {
		get backend() { return renderer.backend.isWebGPUBackend ? 'webgpu' : 'webgl2'; },
		get drawCalls() { return renderer.info.render.drawCalls; },
		get triangles() { return renderer.info.render.triangles; },
		get position() { return camera.position.toArray().map( v => +v.toFixed( 2 ) ); },
		get locked() { return player.isLocked; },
		get active() { return player.isActive; },
		get gameTime() { return +gameTime.toFixed( 2 ); },
		nivel: DEFINITION.name,
		seed,
		levelStats: level.stats,
		lightStats: lighting.stats,
		get bake() { return bakeReport; },
		get entidad() { return { estado: entity.state, distancia: +entity.distance.toFixed( 1 ), timer: +entity.timer.toFixed( 1 ) }; },
		get mision() { return { estado: mission.state, tableros: mission.done + '/' + mission.total, salida: mission.allUp }; },
		renderer, scene, camera, player, level, lighting, flashlight, entity, audio, mission, feedback,

		// Hooks de verificacion, gateados detras de ?debug para que no queden
		// vivos en una build jugable.
		test: debug ? {
			setIgnoreLock( value ) {

				player.ignoreLock = value;
				hud.setPromptVisible( ! value && ! player.isLocked );

			},
			faceYaw( radians ) {

				camera.rotation.set( 0, radians, 0, 'YXZ' );

			},
			teleport( x, z ) {

				player.teleportTo( x, z );

			},
			/** Fuerza la aparicion del enemigo ya mismo. */
			spawnEntity() {

				entity.reset();
				entity.timer = 0;

			},
			/** Lleva al jugador al artefacto apagado mas cercano a una zona muerta. */
			gotoDarkness() {

				const dead = lighting.lights.filter( l => l.intensity === 0 );
				if ( dead.length === 0 ) return null;
				const target = dead[ Math.floor( dead.length / 2 ) ];
				player.teleportTo( target.position.x, target.position.z );
				return [ target.position.x, target.position.z ];

			}
		} : undefined
	};

	console.log( '[backrooms] listo —', renderer.backend.isWebGPUBackend ? 'WebGPU' : 'WebGL2 (fallback)',
		'|', DEFINITION.name, 'seed', seed, '| nivel', level.stats, '| luces', lighting.stats );

}

boot().catch( error => {

	console.error( '[backrooms] fallo el arranque', error );
	document.getElementById( 'readout' ).innerHTML =
		`<span class="bad">fallo el arranque</span>\n${ error.message }`;

} );
