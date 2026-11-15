/**
 * Material presets, read from an installed LaserPecker Design Space if there is one (they're LDS's
 * data, so they're not copied into this app). Keys look like "image_5_254": mode, laser watts, dpi.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Material } from '../shared/types.ts';

const CANDIDATES = [
  path.join(process.env.ProgramFiles ?? 'C:\\Program Files', 'LaserPecker Design Space', 'resources', 'Config', 'pc_lp2_material.json'),
  path.join(process.env.LOCALAPPDATA ?? '', 'Programs', 'LaserPecker Design Space', 'resources', 'Config', 'pc_lp2_material.json'),
];

interface Raw {
  id: string;
  material: string;
  options: Record<string, { printCount: number; printDepth: number; printPower: number }>;
}

const nice = (key: string) => {
  const name = key.split('.').pop() ?? key;
  return name.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
};

export async function loadMaterials(): Promise<Material[]> {
  for (const file of CANDIDATES) {
    try {
      const raw = JSON.parse(await readFile(file, 'utf8')) as Raw[];
      return raw.map((m) => ({
        id: m.id,
        name: nice(m.material),
        presets: Object.entries(m.options).map(([key, v]) => {
          const [mode, , dpi] = key.split('_');
          return { mode: mode as 'line' | 'fill' | 'image', dpi: Number(dpi), passes: v.printCount, depth: v.printDepth, power: v.printPower };
        }),
      }));
    } catch {
      // try the next place
    }
  }
  return [];
}
