import { getCloudflareContext } from '@opennextjs/cloudflare';

/**
 * Same-origin proxy: /api/v1/* on the frontend Worker -> Edge API Worker.
 *
 * Why: *.workers.dev is a public suffix, so the frontend and API Workers are
 * different "sites" to the browser. An HttpOnly session cookie set by the API
 * host would be a third-party cookie and is blocked by modern browsers.
 * Proxying makes the API same-origin, so the session cookie is first-party,
 * SameSite=Lax works, and no CORS is needed.
 *
 * Transport: the EDGE_API service binding (wrangler.jsonc). Workers on the
 * same zone cannot call each other with a plain fetch to the public URL.
 * Local development (`next dev`) falls back to EDGE_API_ORIGIN over HTTPS.
 *
 * The forwarded URL keeps the Edge API's public origin so routes that build
 * absolute URLs (for example the Gmail OAuth redirect URI) are unchanged.
 */

export const dynamic = 'force-dynamic';

interface ServiceBinding {
  fetch(request: Request): Promise<Response>;
}

const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'host',
  'content-length',
]);

const MAX_BODY_BYTES = 12 * 1024 * 1024;

function edgeOrigin(env: Record<string, unknown>): string {
  const value = String(env.EDGE_API_ORIGIN ?? process.env.EDGE_API_ORIGIN ?? '').trim().replace(/\/+$/, '');
  if (!/^https:\/\/[^/]+$/.test(value)) {
    throw new Error('EDGE_API_ORIGIN must be the HTTPS origin of the Edge API Worker');
  }
  return value;
}

async function proxy(request: Request): Promise<Response> {
  let env: Record<string, unknown> = {};
  try {
    env = getCloudflareContext().env as unknown as Record<string, unknown>;
  } catch {
    env = {};
  }

  let origin: string;
  try {
    origin = edgeOrigin(env);
  } catch {
    return Response.json(
      { success: false, message: 'API proxy is not configured', data: null, error: { code: 'PROXY_NOT_CONFIGURED', details: [] } },
      { status: 503 },
    );
  }

  const incoming = new URL(request.url);
  if (!incoming.pathname.startsWith('/api/v1/')) {
    return Response.json({ success: false, message: 'Not found', data: null, error: { code: 'NOT_FOUND', details: [] } }, { status: 404 });
  }
  const target = new URL(`${incoming.pathname}${incoming.search}`, origin);

  const declared = Number(request.headers.get('content-length') ?? '0');
  if (declared > MAX_BODY_BYTES) {
    return Response.json(
      { success: false, message: 'Request body is too large', data: null, error: { code: 'PAYLOAD_TOO_LARGE', details: [] } },
      { status: 413 },
    );
  }

  const headers = new Headers();
  request.headers.forEach((value, key) => {
    if (!HOP_BY_HOP.has(key.toLowerCase())) headers.set(key, value);
  });
  headers.set('X-Forwarded-Host', incoming.host);
  headers.set('X-Forwarded-Proto', incoming.protocol.replace(':', ''));

  const method = request.method.toUpperCase();
  const init: RequestInit = {
    method,
    headers,
    body: method === 'GET' || method === 'HEAD' ? undefined : await request.arrayBuffer(),
    redirect: 'manual',
  };

  const binding = env.EDGE_API as ServiceBinding | undefined;
  let upstream: Response;
  try {
    upstream = binding ? await binding.fetch(new Request(target.toString(), init)) : await fetch(target.toString(), init);
  } catch {
    return Response.json(
      { success: false, message: 'The API is temporarily unreachable. Please try again.', data: null, error: { code: 'UPSTREAM_UNAVAILABLE', details: [] } },
      { status: 502 },
    );
  }

  const responseHeaders = new Headers();
  upstream.headers.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (HOP_BY_HOP.has(lower) || lower === 'set-cookie' || lower.startsWith('access-control-')) return;
    responseHeaders.set(key, value);
  });
  // Preserve every Set-Cookie header individually (session + CSRF cookies).
  const withGetSetCookie = upstream.headers as Headers & { getSetCookie?: () => string[] };
  const cookies = typeof withGetSetCookie.getSetCookie === 'function' ? withGetSetCookie.getSetCookie() : [];
  for (const cookie of cookies) responseHeaders.append('Set-Cookie', cookie);

  return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers: responseHeaders });
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
