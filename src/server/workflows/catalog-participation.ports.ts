import type {
  AdoptCatalogReleaseInput, CatalogAdoptionCommit, CatalogEnvelope,
  CatalogJoinCommit, CatalogJoinPreview, CatalogParticipationSource, CatalogRelease, CatalogRuleDiff,
  CatalogWorkflowResult, DecideCatalogTrackingInput, JoinCatalogActivityInput, PreviewCatalogJoinInput,
} from "../../contracts/activity-catalog";
import type { CatalogActor, CatalogCommandContext } from "../../modules/activity-catalog";

// The implementation chooses its database transaction type; no ORM leaks into contracts.
export interface CatalogUnitOfWork<Transaction> {
  run<Result>(work: (transaction: Transaction) => Promise<Result>): Promise<Result>;
}

// Reads and locks the catalog publication state in the SAME transaction as personal creation.
export interface CatalogJoinReleasePort<Transaction> {
  requireJoinableRelease(input: {
    catalogActivityId: string;
    releaseId: string;
    expectedCatalogVersion: number;
  }, transaction: Transaction): Promise<CatalogRelease>;
}

// Implemented by participation through public ports, retaining the owner/card/rule chain.
export interface PersonalCatalogImportPort<Transaction> {
  joinOwnedCards(input: {
    ownerUserId: string;
    release: CatalogRelease;
    selections: JoinCatalogActivityInput["selections"];
  }, transaction: Transaction): Promise<CatalogJoinCommit>;
}

// Public use cases own authorization, idempotency, shared UnitOfWork and derived actions.
// Signatures are a contract, not a functioning service or a substitute for request validation.
export interface CatalogParticipationWorkflowPort {
  readSource(actor: CatalogActor, participationId: string): Promise<CatalogEnvelope<{ source: CatalogParticipationSource; release: CatalogRelease }>>;
  previewJoin(actor: CatalogActor, catalogActivityId: string, input: PreviewCatalogJoinInput): Promise<CatalogEnvelope<CatalogJoinPreview>>;
  join(context: CatalogCommandContext, catalogActivityId: string, input: JoinCatalogActivityInput): Promise<CatalogWorkflowResult<CatalogJoinCommit>>;
  diff(actor: CatalogActor, participationId: string, targetReleaseId: string): Promise<CatalogEnvelope<CatalogRuleDiff>>;
  adopt(context: CatalogCommandContext, participationId: string, input: AdoptCatalogReleaseInput): Promise<CatalogWorkflowResult<CatalogAdoptionCommit>>;
  decideTracking(context: CatalogCommandContext, participationId: string, input: DecideCatalogTrackingInput): Promise<CatalogEnvelope<CatalogAdoptionCommit>>;
}
