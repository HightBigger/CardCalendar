import { and, desc, eq } from "drizzle-orm";
import { auditLogs } from "../../../db/schema";
import { getDatabase } from "../db/client";
import { getMemoryStore } from "../store/memory";

export type AuditLog = {
  id: string;
  userId?: string;
  actorType: "user" | "system" | "admin";
  actorId?: string;
  action: string;
  entityType: string;
  entityId?: string;
  requestId?: string;
  occurredAt: string;
  metadata: Record<string, unknown>;
};

type AuditInput = Omit<AuditLog, "id" | "occurredAt"> & { occurredAt?: string };

export async function recordAudit(input: AuditInput): Promise<AuditLog> {
  if (process.env.USE_DATABASE === "true") {
    const rows = await getDatabase().db
      .insert(auditLogs)
      .values({
        userId: input.userId ?? null,
        actorType: input.actorType,
        actorId: input.actorId ?? null,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        requestId: input.requestId ?? null,
        occurredAt: input.occurredAt ? new Date(input.occurredAt) : new Date(),
        metadata: input.metadata,
      })
      .returning();
    const row = rows[0];
    return {
      id: String(row.id),
      userId: row.userId ?? undefined,
      actorType: row.actorType as AuditLog["actorType"],
      actorId: row.actorId ?? undefined,
      action: row.action,
      entityType: row.entityType,
      entityId: row.entityId ?? undefined,
      requestId: row.requestId ?? undefined,
      occurredAt: row.occurredAt.toISOString(),
      metadata: row.metadata,
    };
  }

  const now = input.occurredAt ?? new Date().toISOString();
  const log: AuditLog = {
    ...input,
    id: crypto.randomUUID(),
    occurredAt: now,
    metadata: input.metadata ?? {},
  };
  (getMemoryStore().auditLogs as Map<string, AuditLog>).set(log.id, log);
  return log;
}

export async function listAuditLogs(
  userId: string,
  entityType?: string,
  entityId?: string,
): Promise<AuditLog[]> {
  if (process.env.USE_DATABASE === "true") {
    const conditions = [eq(auditLogs.userId, userId)];
    if (entityType) conditions.push(eq(auditLogs.entityType, entityType));
    if (entityId) conditions.push(eq(auditLogs.entityId, entityId));
    const rows = await getDatabase().db
      .select()
      .from(auditLogs)
      .where(and(...conditions))
      .orderBy(desc(auditLogs.occurredAt));
    return rows.map((row) => ({
      id: String(row.id),
      userId: row.userId ?? undefined,
      actorType: row.actorType as AuditLog["actorType"],
      actorId: row.actorId ?? undefined,
      action: row.action,
      entityType: row.entityType,
      entityId: row.entityId ?? undefined,
      requestId: row.requestId ?? undefined,
      occurredAt: row.occurredAt.toISOString(),
      metadata: row.metadata,
    }));
  }

  return [...(getMemoryStore().auditLogs as Map<string, AuditLog>).values()]
    .filter(
      (log) =>
        log.userId === userId &&
        (!entityType || log.entityType === entityType) &&
        (!entityId || log.entityId === entityId),
    )
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
}
