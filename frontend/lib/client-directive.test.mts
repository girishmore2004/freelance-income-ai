import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Next.js only honours 'use client' when it is the first statement of a file
 * (comments may precede it). A misplaced directive type-checks but fails the
 * production build, so check every file under app/ here.
 */

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : /\.(tsx|ts)$/.test(name) ? [path] : [];
  });
}

function firstStatement(source: string): string {
  const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  return withoutComments.trimStart().split('\n')[0].trim();
}

test("'use client' is the first statement wherever it is used", () => {
  const appDir = new URL('../app/', import.meta.url).pathname;
  const offenders = files(appDir).filter((path) => {
    const source = readFileSync(path, 'utf8');
    if (!/^\s*['"]use client['"];?\s*$/m.test(source)) return false;
    return !/^['"]use client['"];?$/.test(firstStatement(source));
  });
  assert.deepEqual(offenders, []);
});
