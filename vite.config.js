import { defineConfig } from 'vite';

export default defineConfig( {
	// Rutas relativas: GitHub Pages sirve el sitio bajo /<repo>/, y con base
	// absoluta los assets darian 404. './' funciona en cualquier subcarpeta.
	base: './',
	server: { port: 5181, strictPort: true }
} );
