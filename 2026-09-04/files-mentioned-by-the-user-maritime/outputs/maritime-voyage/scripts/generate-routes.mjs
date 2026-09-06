/**
 * Precompute water-only port-to-port routes (ocean A*).
 * Run: node scripts/generate-routes.mjs
 */
import { findOceanPath } from '@arcnautical/maritime-routing';
import { mkdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ports = [
  ['Paradip', 20.2644, 86.6729],
  ['Visakhapatnam', 17.6868, 83.2185],
  ['Gangavaram', 17.6167, 83.2333],
  ['Dhamra', 20.8217, 86.9625],
  ['Gladstone', -23.8416, 151.25],
  ['Newcastle', -32.9267, 151.7817]
];

function downsample(coords, target = 280) {
  if (coords.length <= target) return coords;
  const step = Math.ceil(coords.length / target);
  const out = [];
  for (let i = 0; i < coords.length; i++) {
    if (i === 0 || i === coords.length - 1 || i % step === 0) out.push(coords[i]);
  }
  const last = coords[coords.length - 1];
  const tail = out[out.length - 1];
  if (tail[0] !== last[0] || tail[1] !== last[1]) out.push(last);
  return out;
}

const india = ports.filter((p) => p[1] > 0);
const aus = ports.filter((p) => p[1] < 0);
const routes = {};

for (const [on, olat, olng] of india) {
  for (const [dn, dlat, dlng] of aus) {
    const path = findOceanPath(olat, olng, dlat, dlng);
    const coords = downsample(path.map((p) => [p[0], p[1]]));
    coords[0] = [olng, olat];
    coords[coords.length - 1] = [dlng, dlat];
    const key = `${on}->${dn}`;
    routes[key] = {
      type: 'Feature',
      properties: { pair: key, points: coords.length, source: 'ocean-astar' },
      geometry: { type: 'LineString', coordinates: coords }
    };
    console.log(key, coords.length);
  }
}

mkdirSync(join(root, 'public'), { recursive: true });
writeFileSync(join(root, 'public', 'maritime-routes.json'), JSON.stringify(routes));
writeFileSync(join(root, 'maritime-routes.json'), JSON.stringify(routes));
console.log('Wrote', Object.keys(routes).length, 'routes');
