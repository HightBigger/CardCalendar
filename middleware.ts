import { NextResponse, type NextRequest } from "next/server";
import { applySecurityHeaders } from "./src/shared/security/headers";
import { checkSameOriginWrite } from "./src/shared/security/origin";

export function middleware(request: NextRequest): NextResponse {
  let response: NextResponse;
  if (request.nextUrl.pathname.startsWith("/api/")) {
    const originCheck = checkSameOriginWrite(request);
    if (!originCheck.allowed) {
      response = NextResponse.json(
        { error: { code: "FORBIDDEN", message: "请求来源不受信任", request_id: crypto.randomUUID() } },
        { status: 403 },
      );
    } else {
      response = NextResponse.next();
    }
  } else {
    response = NextResponse.next();
  }

  applySecurityHeaders(response.headers, process.env.NODE_ENV === "production");
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
