#!/usr/bin/env node
/*
 * Demo site helper for the "Demo site (test copy)" workflow (2026-11-20).
 *
 * The demo site is a second, separate copy of the app: its own Edge API Worker
 * (freelance-income-ai-api-edge-demo), its own website Worker (freelance-income-ai-demo)
 * and its own database (a Neon branch, DEMO_DATABASE_URL). Production Workers and the
 * production database are never touched: the committed wrangler.jsonc files are only
 * rewritten inside the temporary GitHub runner checkout.
 *
 * Commands:
 *   check                         settings present; demo database is not production
 *   prepare                       finds or creates the Hyperdrive config; prints URLs (GITHUB_OUTPUT)
 *   config-edge <wrangler.jsonc>  rewrites the Edge config for the demo Worker
 *   config-web <wrangler.jsonc>   rewrites the website config for the demo Worker
 *   secret                        sets JWT_SECRET on the demo Edge Worker once
 *   remove                        deletes both demo Workers and the Hyperdrive config
 *
 * Environment: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, DEMO_DATABASE_URL,
 * PRODUCTION_DATABASE_URL (only to refuse it), DEMO_HYPERDRIVE_ID, DEMO_EDGE_URL, DEMO_WEB_URL.
 */
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

export const EDGE_WORKER = 'freelance-income-ai-api-edge-demo';
export const WEB_WORKER = 'freelance-income-ai-demo';
export const HYPERDRIVE_NAME = 'freelance-income-ai-demo-db';

const env = process.env;
const fail = (message) => {
  console.error(`::error::${message}`);
  process.exit(1);
};
const host = (u) => {
  try {
    return new URL(u).hostname.toLowerCase();
  } catch {
    return '';
  }
};

/** Removes // and block comments outside strings, then trailing commas. Exported for tests. */
export function parseJsonc(text) {
  let out = '';
  let inString = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (inString) {
      out += c;
      if (c === '\\') {
        out += text[i + 1] ?? '';
        i += 1;
      } else if (c === '"') inString = false;
    } else if (c === '"') {
      inString = true;
      out += c;
    } else if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i += 1;
      out += '\n';
    } else if (c === '/' && text[i + 1] === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i += 1;
      i += 1;
    } else out += c;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
}

/** Edge API config for the demo Worker. Pure; exported for tests. */
export function demoEdgeConfig(config, { hyperdriveId, webUrl }) {
  const next = structuredClone(config);
  next.name = EDGE_WORKER;
  next.workers_dev = true;
  next.vars = { ...next.vars, APP_ENV: 'demo', CORS_ORIGINS: webUrl, PUBLIC_REGISTRATION: 'true', REQUIRE_EMAIL_VERIFICATION: 'false' };
  next.hyperdrive = [{ binding: 'HYPERDRIVE', id: hyperdriveId }];
  // The job queue belongs to production (a queue has one consumer). Without it the demo
  // runs its scheduled work inline, which the Worker already supports.
  delete next.queues;
  delete next.r2_buckets;
  delete next.routes;
  next.ratelimits = (next.ratelimits ?? []).map((r, i) => ({ ...r, namespace_id: String(2001 + i) }));
  return next;
}

/** Website config for the demo Worker. Pure; exported for tests. */
export function demoWebConfig(config, { edgeUrl }) {
  const next = structuredClone(config);
  next.name = WEB_WORKER;
  next.workers_dev = true;
  next.vars = { ...next.vars, EDGE_API_ORIGIN: edgeUrl };
  delete next.routes;
  next.services = (next.services ?? []).map((s) => {
    if (s.binding === 'WORKER_SELF_REFERENCE') return { ...s, service: WEB_WORKER };
    if (s.binding === 'EDGE_API') return { ...s, service: EDGE_WORKER };
    return s;
  });
  return next;
}

/** Hyperdrive origin from a Neon connection string. Pure; exported for tests. */
export function originFromUrl(u) {
  const p = new URL(u);
  if (!/^postgres(ql)?:$/.test(p.protocol)) throw new Error('DEMO_DATABASE_URL must start with postgresql://');
  return {
    scheme: 'postgres',
    host: p.hostname,
    port: Number(p.port || 5432),
    database: decodeURIComponent(p.pathname.replace(/^\//, '')) || 'neondb',
    user: decodeURIComponent(p.username),
    password: decodeURIComponent(p.password),
  };
}

async function cf(method, path, body) {
  const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}${path}`, {
    method,
    headers: { authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok && j.success !== false, status: r.status, result: j.result, errors: j.errors ?? [] };
}
const explain = (r) => (r.errors ?? []).map((e) => `${e.code}: ${e.message}`).join('; ') || `HTTP ${r.status}`;
const output = (key, value) => {
  console.log(`${key}=${value}`);
  if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `${key}=${value}\n`);
};

async function check() {
  const missing = ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID', 'DEMO_DATABASE_URL'].filter((k) => !String(env[k] ?? '').trim());
  if (missing.length) fail(`Missing repository secret(s): ${missing.join(', ')}. Add them in GitHub → Settings → Secrets and variables → Actions.`);
  if (!host(env.DEMO_DATABASE_URL)) fail('DEMO_DATABASE_URL is not a valid connection string.');
  if (env.PRODUCTION_DATABASE_URL && host(env.PRODUCTION_DATABASE_URL) === host(env.DEMO_DATABASE_URL)) {
    fail("DEMO_DATABASE_URL points at the PRODUCTION database. Copy the connection string of the Neon 'demo' branch instead.");
  }
  console.log(`Demo database host: ${host(env.DEMO_DATABASE_URL)} (not production).`);
}

async function prepare() {
  const sub = await cf('GET', '/workers/subdomain');
  if (!sub.ok || !sub.result?.subdomain) fail(`Could not read your workers.dev subdomain (${explain(sub)}). Check the API token permissions.`);
  const list = await cf('GET', '/hyperdrive/configs');
  if (!list.ok) fail(`Could not list Hyperdrive configs (${explain(list)}). The API token needs Hyperdrive: Edit.`);
  const origin = originFromUrl(env.DEMO_DATABASE_URL);
  let config = (list.result ?? []).find((c) => c.name === HYPERDRIVE_NAME);
  if (config) {
    const upd = await cf('PATCH', `/hyperdrive/configs/${config.id}`, { origin });
    if (!upd.ok) fail(`Could not update the demo Hyperdrive config (${explain(upd)}).`);
  } else {
    const made = await cf('POST', '/hyperdrive/configs', { name: HYPERDRIVE_NAME, origin });
    if (!made.ok) fail(`Could not create the demo Hyperdrive config (${explain(made)}). Check DEMO_DATABASE_URL.`);
    config = made.result;
  }
  output('hyperdrive_id', config.id);
  output('edge_url', `https://${EDGE_WORKER}.${sub.result.subdomain}.workers.dev`);
  output('web_url', `https://${WEB_WORKER}.${sub.result.subdomain}.workers.dev`);
}

function rewrite(path, make) {
  const next = make(parseJsonc(readFileSync(path, 'utf8')));
  writeFileSync(path, JSON.stringify(next, null, 2));
  console.log(`Rewrote ${path} for ${next.name} (this runner only; nothing is committed).`);
}

async function secret() {
  const have = await cf('GET', `/workers/scripts/${EDGE_WORKER}/secrets`);
  if (have.ok && (have.result ?? []).some((s) => s.name === 'JWT_SECRET')) {
    console.log('JWT_SECRET already set on the demo API (sign-ins stay valid).');
    return;
  }
  const put = await cf('PUT', `/workers/scripts/${EDGE_WORKER}/secrets`, { name: 'JWT_SECRET', text: randomBytes(48).toString('base64url'), type: 'secret_text' });
  if (!put.ok) fail(`Could not set JWT_SECRET on the demo API (${explain(put)}).`);
  console.log('JWT_SECRET set on the demo API (random, never shown).');
}

async function remove() {
  for (const name of [WEB_WORKER, EDGE_WORKER]) {
    const r = await cf('DELETE', `/workers/scripts/${name}?force=true`);
    console.log(r.ok ? `Deleted Worker ${name}.` : r.status === 404 ? `Worker ${name} was not there.` : `Could not delete ${name}: ${explain(r)}`);
  }
  const list = await cf('GET', '/hyperdrive/configs');
  for (const c of (list.result ?? []).filter((x) => x.name === HYPERDRIVE_NAME)) {
    const r = await cf('DELETE', `/hyperdrive/configs/${c.id}`);
    console.log(r.ok ? `Deleted Hyperdrive config ${HYPERDRIVE_NAME}.` : `Could not delete Hyperdrive config: ${explain(r)}`);
  }
  console.log("Now delete the 'demo' branch in Neon to remove the demo data itself.");
}

const [command, arg] = process.argv.slice(2);
if (import.meta.url === `file://${process.argv[1]}`) {
  const run = {
    check,
    prepare,
    secret,
    remove,
    'config-edge': async () => rewrite(arg, (c) => demoEdgeConfig(c, { hyperdriveId: env.DEMO_HYPERDRIVE_ID, webUrl: env.DEMO_WEB_URL })),
    'config-web': async () => rewrite(arg, (c) => demoWebConfig(c, { edgeUrl: env.DEMO_EDGE_URL })),
  }[command];
  if (!run) fail(`Unknown command "${command}".`);
  await run();
}
