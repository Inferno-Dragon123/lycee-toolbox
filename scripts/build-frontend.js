import { build } from 'esbuild';
await build({ entryPoints: ['public/community.js'], bundle: true, minify: true, format: 'esm', platform: 'browser', target: 'es2022', outfile: 'public/community.bundle.js' });
console.log('Community browser bundle built');
