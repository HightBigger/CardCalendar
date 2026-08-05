import { AppError } from "../../shared/errors";
import { authRepository } from "./repository";
import { getSessionUser } from "./service";
import { readCookie, SESSION_COOKIE } from "./session";

export async function requireUserId(request: Request): Promise<string> {
  if (process.env.NODE_ENV !== "production" && process.env.AUTH_DEV_HEADER === "true") {
    const devUserId = request.headers.get("x-user-id")?.trim();
    if (devUserId) {
      const user = await authRepository.findUserById(devUserId);
      if (!user || user.status !== "active") throw new AppError("UNAUTHENTICATED", "请先登录");
      return user.id;
    }
  }

  const token = readCookie(request, SESSION_COOKIE);
  if (!token) throw new AppError("UNAUTHENTICATED", "请先登录");

  const user = await getSessionUser(token);
  if (!user) throw new AppError("UNAUTHENTICATED", "请先登录");
  return user.id;
}
