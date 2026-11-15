/**
 * Batch runs: the same design on many parts, with {n} as a counting number and {line} as one line
 * from a list (names, codes). Pure.
 */

export interface BatchSpec {
  count: number;
  start: number;
  step: number;
  digits: number; // pad {n} with zeros to this many digits
  lines: string[]; // values for {line}; if given, the count is the number of lines
}

export const BATCH_DEFAULTS: BatchSpec = { count: 5, start: 1, step: 1, digits: 3, lines: [] };

export const hasPlaceholders = (text: string) => /\{n\}|\{line\}/.test(text);

/** The values for part `index` (0-based). */
export function batchValues(spec: BatchSpec, index: number): { n: string; line: string } {
  const n = spec.start + index * spec.step;
  return { n: String(n).padStart(spec.digits, '0'), line: spec.lines[index] ?? '' };
}

export function fillTemplate(template: string, values: { n: string; line: string }): string {
  return template.replace(/\{n\}/g, values.n).replace(/\{line\}/g, values.line);
}

export const batchCount = (spec: BatchSpec) => (spec.lines.length ? spec.lines.length : Math.max(1, Math.floor(spec.count)));
