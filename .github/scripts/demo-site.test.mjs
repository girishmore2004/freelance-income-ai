import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { demoEdgeConfig, demoWebConfig, originFromUrl, parseJsonc, EDGE_WORKER, WEB_WORKER } from './demo-site.mjs';

const web = parseJsonc(readFileSync(new URL('../../frontend/wrangler.jsonc', import.meta.url), 'utf8'));

test('JSONC comments are removed but URLs inside strings are kept', () => {
  assert.deepEqual(parseJsonc('{ // note\n "a": "https://x.test/y", /* b */ "c": [1,], }'), { a: 'https://x.test/y', c: [1] });
});

test('the demo Edge Worker gets its own name, database, origins and no production queue', () => {
  const prod = { name: 'freelance-income-ai-api-edge', vars: { APP_ENV: 'staging', CORS_ORIGINS: 'https://prod' }, hyperdrive: [{ binding: 'HYPERDRIVE', id: 'PROD' }],
    queues: { consumers: [{ queue: 'freelance-income-ai-jobs' }] }, ratelimits: [{ name: 'AUTH_RATE_LIMITER', namespace_id: '1001' }] };
  const demo = demoEdgeConfig(prod, { hyperdriveId: 'DEMO', webUrl: 'https://demo.web' });
  assert.equal(demo.name, EDGE_WORKER);
  assert.deepEqual(demo.hyperdrive, [{ binding: 'HYPERDRIVE', id: 'DEMO' }]);
  assert.equal(demo.vars.CORS_ORIGINS, 'https://demo.web');
  assert.equal(demo.queues, undefined);
  assert.equal(demo.ratelimits[0].namespace_id, '2001');
  assert.equal(prod.hyperdrive[0].id, 'PROD', 'the production config object is not changed');
});

test('the demo website talks only to the demo API', () => {
  const demo = demoWebConfig(web, { edgeUrl: 'https://demo.api' });
  assert.equal(demo.name, WEB_WORKER);
  assert.equal(demo.vars.EDGE_API_ORIGIN, 'https://demo.api');
  assert.ok(demo.services.every((s) => s.service === WEB_WORKER || s.service === EDGE_WORKER));
});

test('a Neon connection string becomes a Hyperdrive origin', () => {
  assert.deepEqual(originFromUrl('postgresql://owner:p%40ss@ep-x.aws.neon.tech/neondb?sslmode=require'), { scheme: 'postgres', host: 'ep-x.aws.neon.tech', port: 5432, database: 'neondb', user: 'owner', password: 'p@ss' });
  assert.throws(() => originFromUrl('mysql://a:b@h/d'));
});
