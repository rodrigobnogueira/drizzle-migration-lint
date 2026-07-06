import type { LintResult } from '../types';
import { renderJson } from './json';
import { renderPretty } from './pretty';

export type ReporterName = 'pretty' | 'json';

export const REPORTERS: Record<ReporterName, (result: LintResult) => string> = {
  pretty: (result) => renderPretty(result),
  json: renderJson,
};

export function isReporterName(name: string): name is ReporterName {
  return name in REPORTERS;
}
