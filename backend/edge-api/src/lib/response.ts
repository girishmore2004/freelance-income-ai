
export interface ApiMeta {
  request_id?: string;
  timestamp: string;
}

export interface ApiSuccess<T> {
  success: true;
  message: string;
  data: T;
  error: null;
  meta: ApiMeta;
}

export interface ApiFailure {
  success: false;
  message: string;
  data: null;
  error: {
    code: string;
    details: unknown[];
  };
  meta: ApiMeta;
}

function createMeta(requestId?: string): ApiMeta {
  return {
    ...(requestId ? { request_id: requestId } : {}),
    timestamp: new Date().toISOString()
  };
}

export function success<T>(
  data: T,
  message = "Request completed successfully",
  status = 200,
  requestId?: string
): Response {
  const body: ApiSuccess<T> = {
    success: true,
    message,
    data,
    error: null,
    meta: createMeta(requestId)
  };

  return Response.json(body, { status });
}

export function failure(
  code: string,
  message: string,
  status: number,
  requestId?: string,
  details: unknown[] = []
): Response {
  const body: ApiFailure = {
    success: false,
    message,
    data: null,
    error: {
      code,
      details
    },
    meta: createMeta(requestId)
  };

  return Response.json(body, { status });
}

export function notFound(
  path: string,
  requestId?: string
): Response {
  return failure(
    "NOT_FOUND",
    `Route not found: ${path}`,
    404,
    requestId
  );
}

export function internalError(
  requestId?: string
): Response {
  return failure(
    "INTERNAL_SERVER_ERROR",
    "An unexpected server error occurred",
    500,
    requestId
  );
}
