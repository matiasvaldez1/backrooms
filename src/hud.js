/**
 * HUD.
 *
 * El objetivo va arriba a la izquierda y siempre visible: el contrato de bucle
 * exige que sea legible sin leer el codigo, y una sola linea de texto alcanza.
 *
 * La lectura tecnica (backend, fps, draws) queda detras de ?debug. Dejarla en la
 * build jugable es el anti-patron "debug UI shipped as player UI" — y ademas el
 * fallback silencioso de WebGPU a WebGL2 solo le importa a quien desarrolla.
 */
import { t } from './i18n.js';

export class Hud {

	constructor( debug ) {

		this.debug = debug;

		this.objective = document.getElementById( 'objective' );
		this.action = document.getElementById( 'action' );
		this.readout = document.getElementById( 'readout' );
		this.prompt = document.getElementById( 'prompt' );
		this.won = document.getElementById( 'won' );

		if ( ! debug ) this.readout.style.display = 'none';

		this.backend = '?';
		this.extra = '';

		this._frames = 0;
		this._acc = 0;
		this._fps = 0;

	}

	/** @param {() => void} onClick */
	bindPrompt( onClick ) {

		this.prompt.addEventListener( 'click', onClick );

	}

	setPromptVisible( visible ) {

		this.prompt.classList.toggle( 'hidden', ! visible );

	}

	setWon( won ) {

		this.won.classList.toggle( 'on', won );

	}

	/** @param {?{kind: string}} focus lo que el jugador tiene al alcance */
	setAction( focus ) {

		if ( focus === null ) {

			this.action.classList.remove( 'on' );
			return;

		}

		this.action.textContent = t( focus.kind === 'exit' ? 'hud.useExit' : 'hud.useBreaker' );
		this.action.classList.add( 'on' );

	}

	setObjective( mission ) {

		const lines = [ `${ t( 'hud.breakers' ) } <b>${ mission.done }/${ mission.total }</b>` ];

		lines.push( mission.allUp
			? `<span class="ready">${ t( 'hud.exitOpen' ) }</span>`
			: t( 'hud.exitSealed' ) );

		this.objective.innerHTML = lines.join( '<br>' );

	}

	update( delta, info, position, level, seed ) {

		if ( ! this.debug ) return;

		this._frames ++;
		this._acc += delta;

		if ( this._acc < 0.25 ) return;

		this._fps = Math.round( this._frames / this._acc );
		this._frames = 0;
		this._acc = 0;

		const webgpu = this.backend === 'webgpu';
		const backendLine = webgpu
			? '<b>WebGPU</b>'
			: `<span class="bad">${ this.backend } (fallback)</span>`;

		// drawCalls y no calls: bajo WebGPU, info.render.calls cuenta render passes
		// acumulados desde que arranco la app, no draw calls de este frame.
		const draws = info.render.drawCalls ?? info.render.calls;

		this.readout.innerHTML = [
			`${ level.stats.nivel }  seed <b>${ seed }</b>`,
			`backend  ${ backendLine }`,
			`fps      <b>${ this._fps }</b>`,
			`draws    <b>${ draws }</b>  tris <b>${ info.render.triangles.toLocaleString( 'es-AR' ) }</b>`,
			`pos      <b>${ position.x.toFixed( 1 ) }, ${ position.z.toFixed( 1 ) }</b>`,
			`abierto  <b>${ level.stats.openCells }</b>/${ level.stats.totalCells } celdas`,
			this.extra
		].filter( Boolean ).join( '\n' );

	}

}
