import * as THREE from 'three/webgpu';

/**
 * Texturas procedurales. Cero assets descargados: todo sale de un canvas 2D.
 * Un Backrooms no necesita fotogrametria, necesita tres superficies mal envejecidas.
 */

const TEX = 512;

function createCanvas() {

	const canvas = document.createElement( 'canvas' );
	canvas.width = TEX;
	canvas.height = TEX;
	return [ canvas, canvas.getContext( '2d' ) ];

}

function finish( canvas, repeat ) {

	const texture = new THREE.CanvasTexture( canvas );
	texture.wrapS = THREE.RepeatWrapping;
	texture.wrapT = THREE.RepeatWrapping;
	texture.colorSpace = THREE.SRGBColorSpace;
	texture.anisotropy = 8;
	texture.repeat.set( repeat, repeat );
	return texture;

}

/** Ruido fino, el grano que impide que las superficies se vean de plastico. */
function speckle( ctx, count, alpha, size, hue ) {

	for ( let i = 0; i < count; i ++ ) {

		ctx.fillStyle = `hsla(${ hue }, ${ 10 + Math.random() * 30 }%, ${ 20 + Math.random() * 60 }%, ${ Math.random() * alpha })`;
		ctx.fillRect( Math.random() * TEX, Math.random() * TEX, Math.random() * size, Math.random() * size );

	}

}

/**
 * "the madness of mono-yellow". Empapelado amarillento con tiras verticales,
 * manchas de humedad subiendo desde el zocalo y un rodapie mas oscuro.
 */
function wallpaperTexture( palette ) {

	const [ canvas, ctx ] = createCanvas();

	ctx.fillStyle = palette.wallpaper;
	ctx.fillRect( 0, 0, TEX, TEX );

	// Tiras de empapelado: una junta vertical cada 128px.
	for ( let x = 0; x < TEX; x += 128 ) {

		const grad = ctx.createLinearGradient( x, 0, x + 128, 0 );
		grad.addColorStop( 0, palette.wallpaperSeam );
		grad.addColorStop( 0.06, 'rgba(255, 246, 200, 0.05)' );
		grad.addColorStop( 0.5, 'rgba(255, 255, 255, 0)' );
		grad.addColorStop( 1, 'rgba(90, 78, 38, 0.10)' );
		ctx.fillStyle = grad;
		ctx.fillRect( x, 0, 128, TEX );

	}

	// Veta vertical tenue.
	for ( let i = 0; i < 260; i ++ ) {

		const x = Math.random() * TEX;
		ctx.strokeStyle = `rgba(${ 150 + Math.random() * 60 }, ${ 135 + Math.random() * 50 }, ${ 70 + Math.random() * 40 }, ${ Math.random() * 0.12 })`;
		ctx.lineWidth = Math.random() * 2.2;
		ctx.beginPath();
		ctx.moveTo( x, 0 );
		ctx.lineTo( x + ( Math.random() - 0.5 ) * 14, TEX );
		ctx.stroke();

	}

	// Humedad trepando desde el zocalo. La v del quad crece hacia arriba y
	// flipY esta activo, asi que el borde inferior del canvas es el piso.
	//
	// Elipses grandes y regulares aca leen como arcos decorativos, no como
	// humedad: hay que hacerlas chicas, irregulares y de borde sucio.
	for ( let i = 0; i < 34; i ++ ) {

		const x = Math.random() * TEX;
		const h = 24 + Math.random() * 90;
		const w = 14 + Math.random() * 46;
		const grad = ctx.createLinearGradient( 0, TEX, 0, TEX - h );
		grad.addColorStop( 0, `${ palette.damp }, ${ 0.1 + Math.random() * 0.14 })` );
		grad.addColorStop( 0.55, 'rgba(84, 68, 30, 0.05)' );
		grad.addColorStop( 1, 'rgba(84, 68, 30, 0)' );
		ctx.fillStyle = grad;

		// Contorno irregular en vez de media elipse limpia.
		ctx.beginPath();
		ctx.moveTo( x - w, TEX );
		const steps = 7;
		for ( let s = 0; s <= steps; s ++ ) {

			const t = s / steps;
			const px = x - w + t * w * 2;
			const py = TEX - Math.sin( t * Math.PI ) * h * ( 0.55 + Math.random() * 0.45 );
			ctx.lineTo( px, py );

		}
		ctx.lineTo( x + w, TEX );
		ctx.closePath();
		ctx.fill();

	}

	speckle( ctx, 2600, 0.1, 2.4, 46 );

	// Rodapie.
	ctx.fillStyle = 'rgba(70, 58, 26, 0.5)';
	ctx.fillRect( 0, TEX - 14, TEX, 14 );

	return finish( canvas, 1 );

}

/** "the stink of old moist carpet". Trama corta, parches humedos, sin brillo. */
function carpetTexture( palette ) {

	const [ canvas, ctx ] = createCanvas();

	ctx.fillStyle = palette.carpet;
	ctx.fillRect( 0, 0, TEX, TEX );

	// Trama: pelos cortos en dos direcciones.
	for ( let i = 0; i < 9000; i ++ ) {

		const x = Math.random() * TEX;
		const y = Math.random() * TEX;
		const l = 1.5 + Math.random() * 3.5;
		const horizontal = Math.random() < 0.5;
		ctx.strokeStyle = `rgba(${ 60 + Math.random() * 70 }, ${ 54 + Math.random() * 60 }, ${ 32 + Math.random() * 40 }, ${ 0.12 + Math.random() * 0.3 })`;
		ctx.lineWidth = 1;
		ctx.beginPath();
		ctx.moveTo( x, y );
		ctx.lineTo( horizontal ? x + l : x, horizontal ? y : y + l );
		ctx.stroke();

	}

	// Manchas de humedad: mas oscuras y de borde difuso.
	for ( let i = 0; i < 14; i ++ ) {

		const x = Math.random() * TEX;
		const y = Math.random() * TEX;
		const r = 26 + Math.random() * 96;
		const grad = ctx.createRadialGradient( x, y, 0, x, y, r );
		grad.addColorStop( 0, `${ palette.carpetStain }, 0.42)` );
		grad.addColorStop( 0.7, 'rgba(34, 30, 18, 0.18)' );
		grad.addColorStop( 1, 'rgba(34, 30, 18, 0)' );
		ctx.fillStyle = grad;
		ctx.beginPath();
		ctx.arc( x, y, r, 0, Math.PI * 2 );
		ctx.fill();

	}

	return finish( canvas, 1 );

}

/** Placas de cielorraso suspendido, con su grilla y su moteado. */
function ceilingTexture( palette ) {

	const [ canvas, ctx ] = createCanvas();

	ctx.fillStyle = palette.ceilingTile;
	ctx.fillRect( 0, 0, TEX, TEX );

	speckle( ctx, 7000, 0.3, 3, 48 );

	// Grilla del perfil metalico: una placa por cuadrante.
	ctx.strokeStyle = palette.ceilingGrid;
	ctx.lineWidth = 4;
	for ( let i = 0; i <= 2; i ++ ) {

		const p = ( i / 2 ) * TEX;
		ctx.beginPath(); ctx.moveTo( p, 0 ); ctx.lineTo( p, TEX ); ctx.stroke();
		ctx.beginPath(); ctx.moveTo( 0, p ); ctx.lineTo( TEX, p ); ctx.stroke();

	}

	// Manchas de filtracion en algunas placas.
	for ( let i = 0; i < 7; i ++ ) {

		const x = Math.random() * TEX;
		const y = Math.random() * TEX;
		const r = 22 + Math.random() * 54;
		const grad = ctx.createRadialGradient( x, y, 0, x, y, r );
		grad.addColorStop( 0, `${ palette.ceilingLeak }, 0.42)` );
		grad.addColorStop( 1, 'rgba(116, 96, 48, 0)' );
		ctx.fillStyle = grad;
		ctx.beginPath();
		ctx.arc( x, y, r, 0, Math.PI * 2 );
		ctx.fill();

	}

	return finish( canvas, 1 );

}

/**
 * Los tres materiales del casco. `diffuseRoughness` activa el BRDF EON de r187:
 * empapelado mate y alfombra humeda son superficies rough-diffuse, y con Lambert
 * puro se ven como plastico apagado.
 */
export function createMaterials( palette ) {

	const rough = palette.diffuseRoughness;

	const wall = new THREE.MeshPhysicalNodeMaterial( {
		map: wallpaperTexture( palette ),
		roughness: 0.94,
		metalness: 0
	} );
	wall.diffuseRoughness = rough.wall;

	const floor = new THREE.MeshPhysicalNodeMaterial( {
		map: carpetTexture( palette ),
		roughness: 1,
		metalness: 0
	} );
	floor.diffuseRoughness = rough.floor;

	const ceiling = new THREE.MeshPhysicalNodeMaterial( {
		map: ceilingTexture( palette ),
		roughness: 0.88,
		metalness: 0
	} );
	ceiling.diffuseRoughness = rough.ceiling;

	return { wall, floor, ceiling };

}
