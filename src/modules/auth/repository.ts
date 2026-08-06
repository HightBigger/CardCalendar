import { and, eq, gt, isNull } from "drizzle-orm";
import { sessions, users } from "../../../db/schema";
import type { Database } from "../../shared/db/client";
import { getDatabase } from "../../shared/db/client";
import { getMemoryStore } from "../../shared/store/memory";
import type { AuthRepository, SessionRecord, UserRecord } from "./domain";

type UserRow = typeof users.$inferSelect;
type SessionRow = typeof sessions.$inferSelect;

function toUser(row: UserRow): UserRecord {
  return {
    id: row.id,
    email: row.email,
    passwordHash: row.passwordHash,
    timezone: row.timezone,
    status: row.status as UserRecord["status"],
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    deletedAt: row.deletedAt?.toISOString(),
    deletionRequestedAt: row.deletionRequestedAt?.toISOString(),
    deletionCleanupCompletedAt: row.deletionCleanupCompletedAt?.toISOString(),
    deletionCleanupResult: row.deletionCleanupResult,
    deletionRetryCount: row.deletionRetryCount,
  };
}

function toSession(row: SessionRow): SessionRecord {
  return {
    id: row.id,
    userId: row.userId,
    tokenHash: row.tokenHash,
    expiresAt: row.expiresAt.toISOString(),
    lastSeenAt: row.lastSeenAt?.toISOString(),
    revokedAt: row.revokedAt?.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

export class InMemoryAuthRepository implements AuthRepository {
  private readonly users = getMemoryStore().users as Map<string, UserRecord>;
  private readonly sessions = getMemoryStore().sessions as Map<string, SessionRecord>;

  async listActiveUsers() {
    return [...this.users.values()]
      .filter((user) => user.status === "active")
      .map(({ passwordHash: _passwordHash, ...profile }) => profile);
  }

  async listDeletionRequestedUsers() {
    return [...this.users.values()]
      .filter((user) => user.status === "deletion_requested")
      .map(({ passwordHash: _passwordHash, ...profile }) => profile);
  }

  async findUserByEmail(email: string) {
    const normalized = email.trim().toLowerCase();
    return [...this.users.values()].find((user) => user.email === normalized);
  }

  async findUserById(id: string) {
    return this.users.get(id);
  }

  async createUser(input: { email: string; passwordHash: string; timezone?: string; name?: string }) {
    const now = new Date().toISOString();
    const user: UserRecord = {
      id: crypto.randomUUID(),
      email: input.email.trim().toLowerCase(),
      passwordHash: input.passwordHash,
      timezone: input.timezone ?? "Asia/Shanghai",
      name: input.name?.trim() || undefined,
      status: "active",
      createdAt: now,
      updatedAt: now,
    };
    this.users.set(user.id, user);
    return user;
  }

  async createSession(input: { userId: string; tokenHash: string; expiresAt: string }) {
    const session: SessionRecord = {
      id: crypto.randomUUID(),
      userId: input.userId,
      tokenHash: input.tokenHash,
      expiresAt: input.expiresAt,
      createdAt: new Date().toISOString(),
    };
    this.sessions.set(session.id, session);
    return session;
  }

  async findSessionByTokenHash(tokenHash: string) {
    const now = Date.now();
    return [...this.sessions.values()].find(
      (session) =>
        session.tokenHash === tokenHash &&
        !session.revokedAt &&
        new Date(session.expiresAt).getTime() > now,
    );
  }

  async revokeSession(id: string) {
    const session = this.sessions.get(id);
    if (session && !session.revokedAt) {
      this.sessions.set(id, { ...session, revokedAt: new Date().toISOString() });
    }
  }

  async revokeAllSessions(userId: string) {
    for (const [id, session] of this.sessions) {
      if (session.userId === userId && !session.revokedAt) {
        this.sessions.set(id, { ...session, revokedAt: new Date().toISOString() });
      }
    }
  }

  async updateUser(
    userId: string,
    patch: Partial<Pick<UserRecord, "timezone" | "name" | "status" | "deletedAt" | "deletionRequestedAt" | "deletionCleanupCompletedAt" | "deletionCleanupResult" | "deletionRetryCount">>,
  ) {
    const current = this.users.get(userId);
    if (!current) return undefined;
    const updated: UserRecord = {
      ...current,
      ...patch,
      name: patch.name === undefined ? current.name : patch.name?.trim() || undefined,
      updatedAt: new Date().toISOString(),
    };
    this.users.set(userId, updated);
    return updated;
  }

  async anonymizeUser(userId: string) {
    const current = this.users.get(userId);
    if (!current) return undefined;
    const now = new Date().toISOString();
    const anonymized: UserRecord = {
      ...current,
      email: "deleted+" + userId + "@invalid.cardcalendar",
      passwordHash: "anonymized:" + crypto.randomUUID(),
      name: undefined,
      status: "anonymized",
      deletedAt: now,
      updatedAt: now,
    };
    this.users.set(userId, anonymized);
    return anonymized;
  }
}

class DrizzleAuthRepository implements AuthRepository {
  constructor(private readonly db: Database) {}

  async listActiveUsers() {
    const rows = await this.db
      .select()
      .from(users)
      .where(and(eq(users.status, "active"), isNull(users.deletedAt)))
      .orderBy(users.createdAt);
    return rows.map((row) => {
      const { passwordHash: _passwordHash, ...profile } = toUser(row);
      return profile;
    });
  }

  async listDeletionRequestedUsers() {
    const rows = await this.db
      .select()
      .from(users)
      .where(and(eq(users.status, "deletion_requested"), isNull(users.deletedAt)))
      .orderBy(users.createdAt);
    return rows.map((row) => {
      const { passwordHash: _passwordHash, ...profile } = toUser(row);
      return profile;
    });
  }

  async findUserByEmail(email: string) {
    const rows = await this.db
      .select()
      .from(users)
      .where(eq(users.email, email.trim().toLowerCase()))
      .limit(1);
    return rows[0] ? toUser(rows[0]) : undefined;
  }

  async findUserById(id: string) {
    const rows = await this.db.select().from(users).where(eq(users.id, id)).limit(1);
    return rows[0] ? toUser(rows[0]) : undefined;
  }

  async createUser(input: { email: string; passwordHash: string; timezone?: string; name?: string }) {
    const rows = await this.db
      .insert(users)
      .values({
        email: input.email.trim().toLowerCase(),
        passwordHash: input.passwordHash,
        name: input.name?.trim() || null,
        timezone: input.timezone ?? "Asia/Shanghai",
      })
      .returning();
    return toUser(rows[0]);
  }

  async createSession(input: { userId: string; tokenHash: string; expiresAt: string }) {
    const rows = await this.db
      .insert(sessions)
      .values({
        userId: input.userId,
        tokenHash: input.tokenHash,
        expiresAt: new Date(input.expiresAt),
      })
      .returning();
    return toSession(rows[0]);
  }

  async findSessionByTokenHash(tokenHash: string) {
    const now = new Date();
    const rows = await this.db
      .select()
      .from(sessions)
      .where(
        and(
          eq(sessions.tokenHash, tokenHash),
          isNull(sessions.revokedAt),
          gt(sessions.expiresAt, now),
        ),
      )
      .limit(1);
    return rows[0] ? toSession(rows[0]) : undefined;
  }

  async revokeSession(id: string) {
    await this.db
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(sessions.id, id), isNull(sessions.revokedAt)));
  }

  async revokeAllSessions(userId: string) {
    await this.db
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
  }

  async updateUser(
    userId: string,
    patch: Partial<Pick<UserRecord, "timezone" | "name" | "status" | "deletedAt" | "deletionRequestedAt" | "deletionCleanupCompletedAt" | "deletionCleanupResult" | "deletionRetryCount">>,
  ) {
    const values: Partial<typeof users.$inferInsert> = { updatedAt: new Date() };
    if (patch.name !== undefined) values.name = patch.name || null;
    if (patch.timezone !== undefined) values.timezone = patch.timezone;
    if (patch.status !== undefined) values.status = patch.status;
    if (patch.deletedAt !== undefined) values.deletedAt = patch.deletedAt ? new Date(patch.deletedAt) : null;
    if (patch.deletionRequestedAt !== undefined) values.deletionRequestedAt = patch.deletionRequestedAt ? new Date(patch.deletionRequestedAt) : null;
    if (patch.deletionCleanupCompletedAt !== undefined) values.deletionCleanupCompletedAt = patch.deletionCleanupCompletedAt ? new Date(patch.deletionCleanupCompletedAt) : null;
    if (patch.deletionCleanupResult !== undefined) values.deletionCleanupResult = patch.deletionCleanupResult;
    if (patch.deletionRetryCount !== undefined) values.deletionRetryCount = patch.deletionRetryCount;
    const rows = await this.db
      .update(users)
      .set(values)
      .where(eq(users.id, userId))
      .returning();
    return rows[0] ? toUser(rows[0]) : undefined;
  }

  async anonymizeUser(userId: string) {
    const rows = await this.db
      .update(users)
      .set({
        email: "deleted+" + userId + "@invalid.cardcalendar",
        passwordHash: "anonymized:" + crypto.randomUUID(),
        name: null,
        status: "anonymized",
        deletedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId))
      .returning();
    return rows[0] ? toUser(rows[0]) : undefined;
  }
}

function createDefaultRepository(): AuthRepository {
  if (process.env.USE_DATABASE === "true") {
    return new DrizzleAuthRepository(getDatabase().db);
  }
  return new InMemoryAuthRepository();
}

export const authRepository: AuthRepository = createDefaultRepository();
