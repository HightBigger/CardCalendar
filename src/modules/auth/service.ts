import { hash, verify } from "@node-rs/argon2";
import { AppError } from "../../shared/errors";
import { assertRecord, optionalString } from "../../shared/validation";
import type { AuthRepository } from "./domain";
import { authRepository } from "./repository";
import { createSessionToken, hashSessionToken, SESSION_MAX_AGE_SECONDS } from "./session";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function isValidTimezone(value: string): boolean {
  try {
    Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

function publicProfile(user: Awaited<ReturnType<AuthRepository["findUserByEmail"]>>) {
  if (!user) return undefined;
  const { passwordHash: _passwordHash, ...profile } = user;
  return profile;
}

export async function registerUser(
  value: unknown,
  repository: AuthRepository = authRepository,
) {
  const body = assertRecord(value);
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const timezone = body.timezone === undefined ? "Asia/Shanghai" : optionalString(body.timezone, "timezone", 64);
  const name = body.name === undefined ? undefined : optionalString(body.name, "name", 80);

  if (!EMAIL_PATTERN.test(email)) throw new AppError("VALIDATION_ERROR", "邮箱格式无效");
  if (password.length < 8 || password.length > 128) {
    throw new AppError("VALIDATION_ERROR", "密码长度必须为 8 到 128 位");
  }
  if (timezone && !isValidTimezone(timezone)) {
    throw new AppError("VALIDATION_ERROR", "时区格式无效");
  }
  const existing = await repository.findUserByEmail(email);
  if (existing) throw new AppError("CONFLICT", "该邮箱已注册");

  const passwordHash = await hash(password);
  const user = await repository.createUser({ email, passwordHash, timezone, name });
  const session = await createUserSession(user.id, repository);
  return { user: publicProfile(user), token: session.token, expiresIn: SESSION_MAX_AGE_SECONDS };
}

export async function loginUser(
  value: unknown,
  repository: AuthRepository = authRepository,
) {
  const body = assertRecord(value);
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!email || !password) throw new AppError("VALIDATION_ERROR", "邮箱和密码不能为空");

  const user = await repository.findUserByEmail(email);
  if (!user || user.status !== "active") throw new AppError("UNAUTHENTICATED", "邮箱或密码错误");
  const valid = await verify(user.passwordHash, password).catch(() => false);
  if (!valid) throw new AppError("UNAUTHENTICATED", "邮箱或密码错误");

  const session = await createUserSession(user.id, repository);
  return { user: publicProfile(user), token: session.token, expiresIn: SESSION_MAX_AGE_SECONDS };
}

export async function logoutSession(
  token: string | undefined,
  repository: AuthRepository = authRepository,
) {
  if (!token) return;
  const session = await repository.findSessionByTokenHash(hashSessionToken(token));
  if (session) await repository.revokeSession(session.id);
}

export async function getSessionUser(
  token: string,
  repository: AuthRepository = authRepository,
) {
  const session = await repository.findSessionByTokenHash(hashSessionToken(token));
  if (!session || new Date(session.expiresAt).getTime() <= Date.now()) return undefined;
  const user = await repository.findUserById(session.userId);
  if (!user || user.status !== "active") return undefined;
  return publicProfile(user);
}

export async function updateProfile(
  userId: string,
  value: unknown,
  repository: AuthRepository = authRepository,
) {
  const body = assertRecord(value);
  const patch: { timezone?: string; name?: string } = {};
  if (body.timezone !== undefined) {
    const timezone = typeof body.timezone === "string" ? optionalString(body.timezone, "timezone", 64) ?? "" : "";
    if (!isValidTimezone(timezone)) throw new AppError("VALIDATION_ERROR", "时区格式无效");
    patch.timezone = timezone;
  }
  if (body.name !== undefined) patch.name = optionalString(body.name, "name", 80);
  const user = await repository.updateUser(userId, patch);
  if (!user) throw new AppError("NOT_FOUND", "用户不存在");
  return publicProfile(user);
}

export async function requestAccountDeletion(
  userId: string,
  value: unknown,
  repository: AuthRepository = authRepository,
) {
  const body = assertRecord(value);
  if (body.confirmation !== "DELETE") {
    throw new AppError("VALIDATION_ERROR", "请输入 DELETE 确认删除账户");
  }
  const user = await repository.updateUser(userId, { status: "deletion_requested" });
  if (!user) throw new AppError("NOT_FOUND", "用户不存在");
  await repository.revokeAllSessions(userId);
  return { status: "deletion_requested", requestedAt: new Date().toISOString() };
}

async function createUserSession(userId: string, repository: AuthRepository) {
  const token = createSessionToken();
  const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000).toISOString();
  const session = await repository.createSession({
    userId,
    tokenHash: hashSessionToken(token),
    expiresAt,
  });
  return { token, sessionId: session.id };
}

export function toPublicUser(user: Awaited<ReturnType<AuthRepository["findUserByEmail"]>>) {
  return publicProfile(user);
}
