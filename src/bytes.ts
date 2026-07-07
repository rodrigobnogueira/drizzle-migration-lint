import { UsageError } from './errors';

const UNITS = ['B', 'KiB', 'MiB', 'GiB', 'TiB'] as const;

/** Human-readable byte size, e.g. 16777216 → "16 MiB". */
export function formatBytes(bytes: number): string {
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const rounded = unit === 0 ? value : Math.round(value * 10) / 10;
  return `${rounded} ${UNITS[unit]}`;
}

// suffixes are 1024-based (so "16MB" == 16 MiB); good enough for a threshold
const SIZE_RE = /^(\d+(?:\.\d+)?)\s*(b|kb|mb|gb|tb)?$/i;
const MULTIPLIER: Record<string, number> = {
  b: 1,
  kb: 1024,
  mb: 1024 ** 2,
  gb: 1024 ** 3,
  tb: 1024 ** 4,
};

/** Parses a `--size-threshold` value (`16MB`, `1GB`, or a raw byte count) into
 * bytes. Suffixes are 1024-based. Throws UsageError on a malformed value. */
export function parseSize(input: string): number {
  const match = SIZE_RE.exec(input.trim());
  if (!match) {
    throw new UsageError(`invalid size "${input}" (examples: 16MB, 1GB, 10485760)`);
  }
  const unit = (match[2] ?? 'b').toLowerCase();
  return Math.round(Number(match[1]) * (MULTIPLIER[unit] as number));
}
