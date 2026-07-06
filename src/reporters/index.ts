import type { LintResult } from '../types';
import { renderGithub } from './github';
import { renderJson } from './json';
import { renderPretty } from './pretty';

export type ReporterName = 'pretty' | 'json' | 'github';

export const REPORTERS: Record<ReporterName, (result: LintResult) => string> = {
  pretty: (result) => renderPretty(result),
  json: renderJson,
  github: (result) => renderGithub(result),
};

export function isReporterName(name: string): name is ReporterName {
  return name in REPORTERS;
}

/** Default reporter: GitHub annotations under Actions, otherwise pretty. */
export function defaultReporter(env: NodeJS.ProcessEnv = process.env): ReporterName {
  return env.GITHUB_ACTIONS ? 'github' : 'pretty';
}
