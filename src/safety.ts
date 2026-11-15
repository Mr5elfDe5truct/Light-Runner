/** Checks before the laser fires. Pure, so the rules are easy to test and change. */
import { formatDuration } from '../shared/estimate.ts';
import type { Item } from './model.ts';

export interface Warning {
  level: 'caution' | 'danger';
  text: string;
}

const HOT_POWER = 90;
const HOT_DEPTH = 80;
const LONG_JOB_S = 20 * 60;

export function jobWarnings(items: Item[], seconds: number, machine: 'lp2' | 'grbl' = 'lp2'): Warning[] {
  const out: Warning[] = [];
  const hot = items.filter((i) => i.power >= HOT_POWER && (machine === 'grbl' ? (i.speed ?? 1500) <= 600 : i.depth >= HOT_DEPTH));
  if (hot.length)
    out.push({
      level: 'danger',
      text: `${names(hot)}: power ${hot[0].power} % at ${machine === 'grbl' ? `${hot[0].speed ?? 1500} mm/min` : `depth ${hot[0].depth}`} burns very hard. Wood, paper, leather and card can scorch or catch fire. Use a test grid first if this material is new.`,
    });
  const many = items.filter((i) => i.passes >= 5);
  if (many.length) out.push({ level: 'caution', text: `${names(many)}: ${many[0].passes} passes heats the same spot again and again. Check for scorching between passes.` });
  if (seconds > LONG_JOB_S) out.push({ level: 'caution', text: `This will take about ${formatDuration(seconds)}. Don't leave the laser running unattended.` });
  const tinyCode = items.filter((i) => /^(QR|Barcode):/.test(i.name) && Math.min(i.w, i.h) < 8);
  if (tinyCode.length) out.push({ level: 'caution', text: `${names(tinyCode)} is very small; phones may not be able to read it.` });
  return out;
}

/** Whether to ask the person to confirm they'll stay with the laser. */
export const needsAttendance = (warnings: Warning[]) => warnings.some((w) => w.level === 'danger') || warnings.length >= 2;

function names(items: Item[]): string {
  const n = items.map((i) => i.name);
  return n.length <= 2 ? n.join(' and ') : `${n.slice(0, 2).join(', ')} and ${n.length - 2} more`;
}
