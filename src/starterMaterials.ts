/**
 * Starting points for G-code diode lasers, for engraving (not cutting). Written for a 10 W
 * (optical) diode; power is scaled for the laser's own output. Always fine-tune with a Test grid:
 * materials vary a lot.
 */
import type { Material, MaterialPreset } from '../shared/types.ts';

type Row = [mode: 'line' | 'fill' | 'image', power: number, speed: number];

const BASE_WATTS = 10;

const STARTERS: { id: string; name: string; rows: Row[] }[] = [
  { id: 'wood', name: 'Wood: basswood, birch plywood', rows: [['line', 55, 1500], ['fill', 40, 3000], ['image', 30, 3000]] },
  { id: 'hardwood', name: 'Wood: hardwood (oak, walnut)', rows: [['line', 65, 1200], ['fill', 50, 2500], ['image', 40, 2500]] },
  { id: 'mdf', name: 'MDF', rows: [['line', 50, 1500], ['fill', 35, 3000], ['image', 30, 3000]] },
  { id: 'leather', name: 'Leather (vegetable-tanned)', rows: [['line', 30, 2000], ['fill', 22, 3000], ['image', 18, 3000]] },
  { id: 'card', name: 'Card and cardboard', rows: [['line', 15, 3000], ['fill', 10, 4000], ['image', 8, 4000]] },
  { id: 'paper', name: 'Paper', rows: [['line', 8, 3000], ['fill', 6, 4000], ['image', 5, 4000]] },
  { id: 'cork', name: 'Cork', rows: [['line', 25, 2500], ['fill', 18, 3500], ['image', 15, 3500]] },
  { id: 'slate', name: 'Slate', rows: [['line', 70, 1200], ['fill', 60, 2000], ['image', 50, 2000]] },
  { id: 'anodized', name: 'Anodized aluminium', rows: [['line', 80, 1000], ['fill', 70, 1500], ['image', 60, 1500]] },
  { id: 'acrylic', name: 'Acrylic, dark and opaque only', rows: [['line', 45, 1500], ['fill', 35, 2500], ['image', 30, 2500]] },
  { id: 'fabric', name: 'Fabric: cotton, denim', rows: [['line', 15, 3000], ['fill', 12, 4000], ['image', 10, 4000]] },
];

/** The starting points, with power scaled for a laser of `watts` (optical). */
export function starterMaterials(watts: number): Material[] {
  const k = BASE_WATTS / Math.max(1, watts);
  return STARTERS.map((m) => ({
    id: `starter-${m.id}`,
    name: m.name,
    machine: 'grbl',
    starter: true,
    presets: m.rows.flatMap(([mode, power, speed]) =>
      [254, 508].map((dpi): MaterialPreset => ({ mode, dpi, power: Math.max(1, Math.min(100, Math.round(power * k))), depth: 50, passes: 1, speed })),
    ),
  }));
}
