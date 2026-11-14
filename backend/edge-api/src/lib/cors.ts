
import type { Env } from "../types";

const ALLOWED_METHODS = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "OPTIONS"
];

const ALLOWED_HEADERS = [
  "accept",
  "authorization",
  "content-type",
  "origin",
  "x-requested-with",
  "x-request-id"
];

function getAllowedOrigins(env: Env): string[] {
  return (env.CORS_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function addVary(headers: Headers, value: string): void {
  const current = headers.get("Vary");

  const values = new Set(
    (current ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
  );

  values.add(value);
  headers.set("Vary", [...values].join(", "));
}

function withCorsHeaders(
  request: Request,
  response: Response,
  env: Env
): Response {
  const headers = new Headers(response.headers);
  const origin = request.headers.get("Origin");

  addVary(headers, "Origin");

  if (origin && getAllowedOrigins(env).includes(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Credentials", "true");
    headers.set(
      "Access-Control-Expose-Headers",
      "Content-Disposition, X-Request-ID"
    );
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

export function handlePreflight(
  request: Request,
  env: Env,
  requestId: string
): Response {
  const origin = request.headers.get("Origin");
  const requestedMethod = request.headers.get(
    "Access-Control-Request-Method"
  );

  const requestedHeaders = (
    request.headers.get("Access-Control-Request-Headers") ?? ""
  )
    .split(",")
    .map((header) => header.trim().toLowerCase())
    .filter(Boolean);

  if (!origin || !getAllowedOrigins(env).includes(origin)) {
    return Response.json(
      {
        success: false,
        message: "Origin is not allowed",
        data: null,
        error: {
          code: "CORS_ORIGIN_DENIED",
          details: []
        },
        meta: {
          request_id: requestId,
          timestamp: new Date().toISOString()
        }
      },
      { status: 403 }
    );
  }

  if (
    !requestedMethod ||
    !ALLOWED_METHODS.includes(requestedMethod.toUpperCase())
  ) {
    return Response.json(
      {
        success: false,
        message: "Requested method is not allowed",
        data: null,
        error: {
          code: "CORS_METHOD_DENIED",
          details: []
        },
        meta: {
          request_id: requestId,
          timestamp: new Date().toISOString()
        }
      },
      { status: 403 }
    );
  }

  const invalidHeaders = requestedHeaders.filter(
    (header) => !ALLOWED_HEADERS.includes(header)
  );

  if (invalidHeaders.length > 0) {
    return Response.json(
      {
        success: false,
        message: "One or more request headers are not allowed",
        data: null,
        error: {
          code: "CORS_HEADERS_DENIED",
          details: invalidHeaders
        },
        meta: {
          request_id: requestId,
          timestamp: new Date().toISOString()
        }
      },
      { status: 403 }
    );
  }

  const headers = new Headers({
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Methods": ALLOWED_METHODS.join(", "),
    "Access-Control-Allow-Headers": ALLOWED_HEADERS.join(", "),
    "Access-Control-Max-Age": "600",
    "Content-Length": "0",
    "X-Request-ID": requestId
  });

  addVary(headers, "Origin");
  addVary(headers, "Access-Control-Request-Method");
  addVary(headers, "Access-Control-Request-Headers");

  return new Response(null, {
    status: 204,
    headers
  });
}

export function applyCors(
  request: Request,
  response: Response,
  env: Env
): Response {
  return withCorsHeaders(request, response, env);
}
