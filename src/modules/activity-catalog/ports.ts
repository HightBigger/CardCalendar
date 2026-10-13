import type {
  CatalogAdminCommit, CatalogAdminDetail, CatalogAdminFilter, CatalogAdminSummary,
  CatalogCapabilities, CatalogDetail, CatalogDraft, CatalogDraftPreview,
  CatalogEnvelope, CatalogFilter, CatalogList, CatalogRelease, CreateCatalogDraftInput,
  PublishCatalogDraftInput, UpdateCatalogDraftInput, WithdrawCatalogInput,
} from "../../contracts/activity-catalog";

// Constructed by session authentication. Never accept actor identity from request JSON.
export type CatalogActor = { userId: string; sessionId: string };
export type CatalogCommandContext = { actor: CatalogActor; idempotencyKey: string };

// Implementations re-read active account/session and grants for each request/transaction.
export interface CatalogAccessPort<Transaction> {
  requireActiveMember(actor: CatalogActor, transaction: Transaction): Promise<void>;
  requireCatalogManager(actor: CatalogActor, transaction: Transaction): Promise<void>;
  getCapabilities(actor: CatalogActor): Promise<CatalogCapabilities>;
}

// All methods enforce current server authorization; member DTOs never include drafts.
export interface CatalogQueryPort {
  list(actor: CatalogActor, filter: CatalogFilter): Promise<CatalogEnvelope<CatalogList>>;
  detail(actor: CatalogActor, catalogActivityId: string): Promise<CatalogEnvelope<CatalogDetail>>;
  readRelease(actor: CatalogActor, catalogActivityId: string, releaseId: string): Promise<CatalogEnvelope<CatalogRelease>>;
  adminList(actor: CatalogActor, filter: CatalogAdminFilter): Promise<CatalogEnvelope<{ items: CatalogAdminSummary[]; total: number }>>;
  adminDetail(actor: CatalogActor, catalogActivityId: string): Promise<CatalogEnvelope<CatalogAdminDetail>>;
  previewDraft(actor: CatalogActor, catalogActivityId: string, draftId: string): Promise<CatalogEnvelope<CatalogDraftPreview>>;
}

// Implementations commit catalog state, history, idempotency and outbox together.
export interface CatalogCommandPort {
  createDraft(context: CatalogCommandContext, input: CreateCatalogDraftInput): Promise<CatalogEnvelope<CatalogDraft>>;
  startRevision(context: CatalogCommandContext, catalogActivityId: string, input: { expectedVersion: number }): Promise<CatalogEnvelope<CatalogDraft>>;
  updateDraft(context: CatalogCommandContext, catalogActivityId: string, draftId: string, input: UpdateCatalogDraftInput): Promise<CatalogEnvelope<CatalogDraft>>;
  publish(context: CatalogCommandContext, catalogActivityId: string, input: PublishCatalogDraftInput): Promise<CatalogEnvelope<CatalogAdminCommit>>;
  withdraw(context: CatalogCommandContext, catalogActivityId: string, input: WithdrawCatalogInput): Promise<CatalogEnvelope<CatalogAdminCommit>>;
}
