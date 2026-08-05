export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
  ) {
    super(message);
  }
}

type ApiResponse<T> = { data: T };

export async function apiJson<T>(
  path: string,
  options: RequestInit = {},
): Promise<ApiResponse<T>> {
  const headers = new Headers(options.headers);
  if (options.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  const response = await fetch(path, {
    ...options,
    credentials: "same-origin",
    headers,
  });

  if (response.status === 401 && !path.startsWith("/api/v1/auth/")) {
    window.location.assign("/login");
    throw new ApiError("请先登录", 401, "UNAUTHENTICATED");
  }

  const body = (await response.json().catch(() => null)) as {
    data?: T;
    error?: { message?: string; code?: string };
  } | null;

  if (!response.ok) {
    throw new ApiError(
      body?.error?.message ?? "请求失败，请稍后重试",
      response.status,
      body?.error?.code,
    );
  }
  return body as ApiResponse<T>;
}
