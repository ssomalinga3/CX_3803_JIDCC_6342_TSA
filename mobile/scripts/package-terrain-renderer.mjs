import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';

const require = createRequire(import.meta.url);
const root = dirname(require.resolve('maplibre-gl/package.json'));
const [js, css, license, metadata] = await Promise.all(
  ['dist/maplibre-gl.js', 'dist/maplibre-gl.css', 'LICENSE.txt', 'package.json'].map((file) =>
    readFile(join(root, file), 'utf8'),
  ),
);
const content =
  JSON.stringify({
    version: JSON.parse(metadata).version,
    sha256: createHash('sha256').update(js).digest('hex'),
    // Source maps are development-only; the WebView never requests external resources.
    js: js.replace(/\/\/# sourceMappingURL=.*$/gm, ''),
    css: css.replace(/\/\*# sourceMappingURL=.*?\*\//gs, ''),
    license,
  }) + '\n';
if (Buffer.byteLength(content) > 2_000_000) throw new Error('3D renderer exceeds 2 MB budget');
const output = fileURLToPath(new URL('../assets/terrain-3d/renderer.json', import.meta.url));
if (process.argv.includes('--check')) {
  if ((await readFile(output, 'utf8')) !== content) throw new Error('3D renderer asset is stale');
} else {
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, content);
}
console.log(`MapLibre GL JS ${JSON.parse(metadata).version}: ${Buffer.byteLength(content)} bytes`);
