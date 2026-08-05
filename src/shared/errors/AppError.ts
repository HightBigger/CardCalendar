export type ErrorCode =
  | "VALIDATION_ERROR"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "UNPROCESSABLE_ENTITY"
  | "INTERNAL_ERROR";

export class AppError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, status = statusFor(code), details?: unknown) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function statusFor(code: ErrorCode): number {
  switch (code) {
    case "UNAUTHENTICATED": return 401;
    case "FORBIDDEN": return 403;
    case "NOT_FOUND": return 404;
    case "CONFLICT": return 409;
    case "UNPROCESSABLE_ENTITY": return 422;
    case "VALIDATION_ERROR": return 400;
    default: return 500;
  }
}

export function errorResponse(error: unknown, requestId = crypto.randomUUID()): Response {
  const appError = error instanceof AppError
    ? error
    : error instanceof SyntaxError
      ? new AppError("VALIDATION_ERROR", "请求体不是有效的 JSON")
    : new AppError("INTERNAL_ERROR", "服务器暂时无法处理请求");
  return new Response(JSON.stringify({ error: {
    code: appError.code,
    message: appError.message,
    ...(appError.details === undefined ? {} : { details: appError.details }),
    request_id: requestId,
  }}), { status: appError.status, headers: { "content-type": "application/json; charset=utf-8" } });
}
