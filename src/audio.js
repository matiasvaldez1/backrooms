/**
 * Todo el audio es sintetizado con WebAudio. Cero archivos.
 *
 * El zumbido es global y no posicional a proposito: el canon dice "the endless
 * background noise of fluorescent lights at maximum hum-buzz" — es omnipresente,
 * no una fuente que uno localiza. Un global con la ganancia modulada por la
 * cercania al tubo vivo mas proximo da eso, y evita 49 voces posicionales.
 */

import * as THREE from 'three/webgpu';

const FLOOR = 0.0001;   // los ramps exponenciales no pueden tocar cero

export class AudioEngine {

	constructor() {

		this.ctx = null;
		this.ready = false;
		this.noiseBuffer = null;

		// Se lee antes de que exista el AudioContext: si el usuario lo dejo en
		// silencio, no tiene que oir un zumbido al volver.
		this.muted = false;
		try { this.muted = localStorage.getItem( 'backrooms.muted' ) === '1'; } catch ( e ) { /* sin persistencia */ }

		this._lastStep = 0;

		const unlock = () => {

			this.unlock();
			window.removeEventListener( 'pointerdown', unlock );
			window.removeEventListener( 'keydown', unlock );

		};

		// El navegador exige un gesto del usuario para arrancar un AudioContext.
		window.addEventListener( 'pointerdown', unlock, { once: true } );
		window.addEventListener( 'keydown', unlock, { once: true } );

	}

	async unlock() {

		if ( this.ready ) return;

		// El mismo contexto que usa three: si el AudioListener creara el suyo,
		// serian dos grafos separados, imposibles de mezclar o silenciar juntos.
		this.ctx = THREE.AudioContext.getContext();
		if ( ! this.ctx ) return;

		await this.ctx.resume();

		this.master = this.ctx.createGain();
		this.master.gain.value = this.muted ? 0 : 0.9;
		this.master.connect( this.ctx.destination );

		// Zumbido y retumbe pasan por acá para poder agacharlos juntos en el
		// momento del impacto. Sin duck, el golpe compite con el ambiente y pierde.
		this.ambience = this.ctx.createGain();
		this.ambience.gain.value = 1;
		this.ambience.connect( this.master );

		this._buildNoise();
		this._buildHum();
		this._buildDread();

		this.ready = true;

	}

	_buildNoise() {

		const seconds = 2;
		const length = this.ctx.sampleRate * seconds;
		const buffer = this.ctx.createBuffer( 1, length, this.ctx.sampleRate );
		const data = buffer.getChannelData( 0 );

		for ( let i = 0; i < length; i ++ ) data[ i ] = Math.random() * 2 - 1;

		this.noiseBuffer = buffer;

	}

	/**
	 * Zumbido de balasto: la fundamental de red y sus armonicos impares, que es
	 * lo que hace que suene electrico y no a nota musical. Mas un lecho de ruido
	 * filtrado para el siseo del tubo.
	 */
	_buildHum() {

		const ctx = this.ctx;

		this.humGain = ctx.createGain();
		this.humGain.gain.value = FLOOR;
		this.humGain.connect( this.ambience );

		const shaper = ctx.createBiquadFilter();
		shaper.type = 'lowpass';
		shaper.frequency.value = 1800;
		shaper.connect( this.humGain );

		for ( const [ freq, level ] of [ [ 100, 0.5 ], [ 200, 0.26 ], [ 300, 0.13 ], [ 500, 0.05 ] ] ) {

			const osc = ctx.createOscillator();
			osc.type = 'sawtooth';
			osc.frequency.value = freq;
			// Desafinado minimo: dos tubos nunca estan en fase.
			osc.detune.value = ( Math.random() - 0.5 ) * 14;

			const gain = ctx.createGain();
			gain.gain.value = level * 0.1;

			osc.connect( gain ).connect( shaper );
			osc.start();

		}

		// Siseo.
		const hiss = ctx.createBufferSource();
		hiss.buffer = this.noiseBuffer;
		hiss.loop = true;

		const hissBand = ctx.createBiquadFilter();
		hissBand.type = 'bandpass';
		hissBand.frequency.value = 3600;
		hissBand.Q.value = 0.8;

		const hissGain = ctx.createGain();
		hissGain.gain.value = 0.012;

		hiss.connect( hissBand ).connect( hissGain ).connect( this.humGain );
		hiss.start();

	}

	/** Retumbe grave que sube con la cercania del enemigo. */
	_buildDread() {

		const ctx = this.ctx;

		this.dreadGain = ctx.createGain();
		this.dreadGain.gain.value = FLOOR;
		this.dreadGain.connect( this.ambience );

		this.dreadFilter = ctx.createBiquadFilter();
		this.dreadFilter.type = 'lowpass';
		this.dreadFilter.frequency.value = 90;
		this.dreadFilter.Q.value = 3;
		this.dreadFilter.connect( this.dreadGain );

		const source = ctx.createBufferSource();
		source.buffer = this.noiseBuffer;
		source.loop = true;
		source.connect( this.dreadFilter );
		source.start();

		const sub = ctx.createOscillator();
		sub.type = 'sine';
		sub.frequency.value = 33;
		const subGain = ctx.createGain();
		subGain.gain.value = 0.6;
		sub.connect( subGain ).connect( this.dreadGain );
		sub.start();

	}

	/** @param {boolean} muted @returns {boolean} el estado resultante */
	setMuted( muted ) {

		this.muted = muted;

		try { localStorage.setItem( 'backrooms.muted', muted ? '1' : '0' ); } catch ( e ) { /* sin persistencia */ }

		if ( this.ready ) {

			this.master.gain.setTargetAtTime( muted ? 0 : 0.9, this.ctx.currentTime, 0.02 );

		}

		return this.muted;

	}

	/** @param {number} value 1 normal, ~0.6 mientras dura un impacto */
	setDuck( value ) {

		if ( ! this.ready || this.muted ) return;
		this.ambience.gain.setTargetAtTime( value, this.ctx.currentTime, 0.04 );

	}

	/** @param {number} level 0..1 segun cercania al fluorescente vivo mas proximo */
	setHumLevel( level ) {

		if ( ! this.ready ) return;
		const target = Math.max( FLOOR, level * 0.1 );
		this.humGain.gain.setTargetAtTime( target, this.ctx.currentTime, 0.25 );

	}

	/** @param {number} level 0..1 segun cercania del enemigo */
	setDread( level ) {

		if ( ! this.ready ) return;
		this.dreadGain.gain.setTargetAtTime( Math.max( FLOOR, level * 0.5 ), this.ctx.currentTime, 0.3 );
		this.dreadFilter.frequency.setTargetAtTime( 70 + level * 180, this.ctx.currentTime, 0.3 );

	}

	/**
	 * Paso sobre alfombra: golpe sordo y corto, sin cola.
	 * @param {boolean} loud corriendo — mas cuerpo y mas agudos, el que te delata
	 */
	footstep( loud = false ) {

		if ( ! this.ready ) return;

		const ctx = this.ctx;
		const now = ctx.currentTime;

		const source = ctx.createBufferSource();
		source.buffer = this.noiseBuffer;
		// Variar el tono en cada repeticion o suena a ametralladora.
		source.playbackRate.value = 0.82 + Math.random() * 0.26;

		const band = ctx.createBiquadFilter();
		band.type = 'lowpass';
		band.frequency.value = ( loud ? 620 : 420 ) + Math.random() * 180;

		const gain = ctx.createGain();
		gain.gain.setValueAtTime( FLOOR, now );
		gain.gain.exponentialRampToValueAtTime( loud ? 0.14 : 0.07, now + 0.012 );
		gain.gain.exponentialRampToValueAtTime( FLOOR, now + 0.14 );

		source.connect( band ).connect( gain ).connect( this.master );
		source.start( now );
		source.stop( now + 0.18 );

	}

	/** Lo que se oye cuando algo aparece. No es un grito: es una puerta lejana. */
	spawnCue() {

		if ( ! this.ready ) return;

		const ctx = this.ctx;
		const now = ctx.currentTime;

		const osc = ctx.createOscillator();
		osc.type = 'triangle';
		osc.frequency.setValueAtTime( 128, now );
		osc.frequency.exponentialRampToValueAtTime( 44, now + 0.7 );

		const gain = ctx.createGain();
		gain.gain.setValueAtTime( FLOOR, now );
		gain.gain.exponentialRampToValueAtTime( 0.1, now + 0.03 );
		gain.gain.exponentialRampToValueAtTime( FLOOR, now + 1.1 );

		osc.connect( gain ).connect( this.master );
		osc.start( now );
		osc.stop( now + 1.2 );

	}

	/** Te vio. Corto y agudo: es el aviso, no el susto. */
	noticed() {

		if ( ! this.ready ) return;

		const ctx = this.ctx;
		const now = ctx.currentTime;

		const osc = ctx.createOscillator();
		osc.type = 'sine';
		osc.frequency.setValueAtTime( 740, now );
		osc.frequency.exponentialRampToValueAtTime( 180, now + 0.45 );

		const gain = ctx.createGain();
		gain.gain.setValueAtTime( FLOOR, now );
		gain.gain.exponentialRampToValueAtTime( 0.045, now + 0.015 );
		gain.gain.exponentialRampToValueAtTime( FLOOR, now + 0.5 );

		osc.connect( gain ).connect( this.master );
		osc.start( now );
		osc.stop( now + 0.55 );

	}

	/**
	 * Voz posicional de la entidad. El retumbe global dice QUE TAN cerca esta;
	 * esto dice DE QUE LADO, que es lo que la linea canonica promete y lo que
	 * un gain global no puede dar.
	 *
	 * Va por setNodeSource y no por setBuffer: asi three panea la cola de MI
	 * grafo y los pasos se disparan desde aca sin pelear con el control de
	 * reproduccion (setNodeSource pone hasPlaybackControl en false a proposito).
	 *
	 * @param {THREE.AudioListener} listener
	 * @param {THREE.Object3D} carrier objeto al que se engancha la voz
	 */
	attachEntityVoice( listener, carrier ) {

		if ( ! this.ready ) return { step() {} };

		const ctx = this.ctx;

		const bus = ctx.createGain();
		bus.gain.value = 1;

		const voice = new THREE.PositionalAudio( listener );
		voice.setNodeSource( bus );
		voice.setRefDistance( 3 );
		voice.setDistanceModel( 'inverse' );
		voice.setRolloffFactor( 1.6 );
		voice.setMaxDistance( 34 );
		carrier.add( voice );

		const noise = this.noiseBuffer;
		const master = this.master;

		return {
			voice,
			/** Pisada: mas seca y mas grave que la del jugador. */
			step() {

				const now = ctx.currentTime;

				const source = ctx.createBufferSource();
				source.buffer = noise;
				source.playbackRate.value = 0.58 + Math.random() * 0.18;

				const band = ctx.createBiquadFilter();
				band.type = 'lowpass';
				band.frequency.value = 260 + Math.random() * 90;

				const gain = ctx.createGain();
				gain.gain.setValueAtTime( FLOOR, now );
				gain.gain.exponentialRampToValueAtTime( 0.9, now + 0.008 );
				gain.gain.exponentialRampToValueAtTime( FLOOR, now + 0.2 );

				source.connect( band ).connect( gain ).connect( bus );
				source.start( now );
				source.stop( now + 0.24 );

			},
			dispose() {

				carrier.remove( voice );
				voice.disconnect();

			}
		};

	}

	/**
	 * La muerte, en cuatro capas.
	 *
	 * Una sola fuente nunca suena visceral: lo que da cuerpo es que el oído
	 * reciba a la vez un transiente que define el golpe, un sub que lo hace
	 * sentir en el pecho, disonancia que lo vuelve desagradable, y una cola que
	 * lo deja resonando. Por separado ninguna de las cuatro asusta.
	 */
	caught() {

		if ( ! this.ready ) return;

		const ctx = this.ctx;
		const now = ctx.currentTime;
		const out = this.master;

		// 1. Transiente: el crack. Corto, brillante, define el instante del golpe.
		const crack = ctx.createBufferSource();
		crack.buffer = this.noiseBuffer;
		crack.playbackRate.value = 1.4 + Math.random() * 0.2;

		const crackFilter = ctx.createBiquadFilter();
		crackFilter.type = 'highpass';
		crackFilter.frequency.setValueAtTime( 1800, now );
		crackFilter.frequency.exponentialRampToValueAtTime( 320, now + 0.09 );

		const crackGain = ctx.createGain();
		crackGain.gain.setValueAtTime( 0.55, now );
		crackGain.gain.exponentialRampToValueAtTime( FLOOR, now + 0.12 );

		crack.connect( crackFilter ).connect( crackGain ).connect( out );
		crack.start( now );
		crack.stop( now + 0.14 );

		// 2. Sub: cae de 55 a 28 Hz. No se escucha tanto como se siente.
		const sub = ctx.createOscillator();
		sub.type = 'sine';
		sub.frequency.setValueAtTime( 55, now );
		sub.frequency.exponentialRampToValueAtTime( 28, now + 0.85 );

		const subGain = ctx.createGain();
		subGain.gain.setValueAtTime( FLOOR, now );
		subGain.gain.exponentialRampToValueAtTime( 0.75, now + 0.02 );
		subGain.gain.exponentialRampToValueAtTime( FLOOR, now + 1.0 );

		sub.connect( subGain ).connect( out );
		sub.start( now );
		sub.stop( now + 1.05 );

		// 3. Disonancia: dos osciladores apenas desafinados barriendo hacia abajo.
		// El batido entre ambos es lo que lo vuelve desagradable y no solo grave.
		for ( const [ freq, detune ] of [ [ 196, - 14 ], [ 207, 18 ] ] ) {

			const osc = ctx.createOscillator();
			osc.type = 'sawtooth';
			osc.frequency.setValueAtTime( freq, now );
			osc.frequency.exponentialRampToValueAtTime( freq * 0.38, now + 0.7 );
			osc.detune.value = detune;

			const lp = ctx.createBiquadFilter();
			lp.type = 'lowpass';
			lp.frequency.setValueAtTime( 1400, now );
			lp.frequency.exponentialRampToValueAtTime( 180, now + 0.7 );

			const gain = ctx.createGain();
			gain.gain.setValueAtTime( FLOOR, now );
			gain.gain.exponentialRampToValueAtTime( 0.16, now + 0.03 );
			gain.gain.exponentialRampToValueAtTime( FLOOR, now + 0.85 );

			osc.connect( lp ).connect( gain ).connect( out );
			osc.start( now );
			osc.stop( now + 0.9 );

		}

		// 4. Cola: ruido con el lowpass cerrandose. Deja el silencio sucio.
		const tail = ctx.createBufferSource();
		tail.buffer = this.noiseBuffer;
		tail.loop = true;

		const tailFilter = ctx.createBiquadFilter();
		tailFilter.type = 'lowpass';
		tailFilter.frequency.setValueAtTime( 900, now );
		tailFilter.frequency.exponentialRampToValueAtTime( 90, now + 1.6 );

		const tailGain = ctx.createGain();
		tailGain.gain.setValueAtTime( FLOOR, now );
		tailGain.gain.exponentialRampToValueAtTime( 0.1, now + 0.05 );
		tailGain.gain.exponentialRampToValueAtTime( FLOOR, now + 1.7 );

		tail.connect( tailFilter ).connect( tailGain ).connect( out );
		tail.start( now );
		tail.stop( now + 1.75 );

	}

	/** Al reiniciar hay que cortar el pavor o se apila con el del intento anterior. */
	reset() {

		if ( ! this.ready ) return;
		this.dreadGain.gain.cancelScheduledValues( this.ctx.currentTime );
		this.dreadGain.gain.setValueAtTime( FLOOR, this.ctx.currentTime );
		this.ambience.gain.cancelScheduledValues( this.ctx.currentTime );
		this.ambience.gain.setValueAtTime( 1, this.ctx.currentTime );

	}

}
