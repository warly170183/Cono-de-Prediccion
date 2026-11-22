// Genera el ejecutable de la app: release/TradingPredictor.exe (Windows por defecto).
//   npm run build:exe               -> Windows x64
//   npm run build:exe -- linux      -> Linux x64   (para probar)
//   npm run build:exe -- macos      -> macOS x64
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);

const targets = {
  windows: { pkg: 'node22-win-x64', out: 'TradingPredictor.exe' },
  linux: { pkg: 'node22-linux-x64', out: 'TradingPredictor-linux' },
  macos: { pkg: 'node22-macos-x64', out: 'TradingPredictor-macos' },
};
const key = process.argv[2] ?? 'windows';
const target = targets[key];
if (!target) {
  console.error(`Objetivo desconocido "${key}". Usa: ${Object.keys(targets).join(', ')}`);
  process.exit(1);
}

const run = (cmd) => execSync(cmd, { stdio: 'inherit' });

console.log('1/3 Compilando la interfaz (vite build)…');
run('npx vite build');

console.log('2/3 Empaquetando el servidor en un solo fichero…');
fs.mkdirSync('build', { recursive: true });
await build({
  entryPoints: ['server.ts'],
  outfile: 'build/server.cjs',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  external: ['vite', 'fsevents'], // vite solo se usa en desarrollo
  logLevel: 'warning',
});

console.log(`3/3 Generando ${target.out} (${target.pkg})…`);
fs.mkdirSync('release', { recursive: true });
const out = path.join('release', target.out);
run(`npx pkg build/server.cjs --targets ${target.pkg} --output "${out}" --config pkg.config.json`);

const mb = (fs.statSync(out).size / 1024 / 1024).toFixed(0);
console.log(`\nListo: ${out} (${mb} MB). Doble clic para arrancar; los datos se guardan en la carpeta "data" junto al ejecutable.`);
