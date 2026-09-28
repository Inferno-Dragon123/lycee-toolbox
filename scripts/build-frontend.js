import { build } from 'esbuild';
await build({ entryPoints: ['public/community.js'], bundle: true, minify: true, format: 'esm', platform: 'browser', target: 'es2022', outfile: 'public/community.bundle.js' });
await build({ entryPoints: ['public/print-pdf.js'], bundle: true, minify: true, format: 'esm', platform: 'browser', target: 'es2022', outfile: 'public/print-pdf.bundle.js' });
console.log('Community and print PDF browser bundles built');
