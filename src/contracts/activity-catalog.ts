// PRD 23 transport contracts. These types do not implement authorization or persistence.
import type { NodePreference } from "./activities";
import type { CardIdentity, CommandResult, DateValue, QueryMeta, Resource } from "./workbench";

export type CatalogCapabilities = {
  canReadCatalog: boolean;
  canManageCatalog: boolean;
  permissionsVersion: number;
};

export type CatalogPublicationStatus = "unpublished" | "published" | "withdrawn";
export type CatalogActivityPhase = "upcoming" | "ongoing" | "ended" | "cancelled";
export type CatalogResource = Resource | "activity-catalog" | "catalog-admin" | "session-capabilities";
export type CatalogEnvelope<T> = { data: T; meta: QueryMeta };
export type CatalogImpact = { resources: CatalogResource[]; catalogActivityIds: string[]; participationIds: string[] };

export type CatalogUnknownItem = { code: string; field: string; reason: string; blocksExecution: boolean };
export type CatalogValidationIssue = {
  code: string;
  field: string;
  message: string;
  severity: "blocks_publication" | "blocks_execution" | "warning";
};
export type CatalogOfficialSource = {
  url: string;
  excerpt: string;
  accessedAt: string | null;
  verifiedAt: string | null;
  completeness: "complete" | "partial" | "unknown";
};

export type CatalogTarget = {
  kind: "count" | "amount" | "count_and_amount" | "count_or_amount" | "custom";
  count: number | null;
  amount: string | null;
  currency: string | null;
  rulesText: string;
};
export type CatalogPeriodTemplate = {
  type: "month" | "billing" | "custom" | "once";
  timezone: string | null;
  countingBasis: "occurred" | "posted" | "settled" | "unknown";
  partialPolicy: "full_target" | "source_defined" | "needs_review";
  target: CatalogTarget;
  periods: { periodKey: string; start: DateValue; end: DateValue; target: CatalogTarget }[];
};
export type CatalogRewardTemplate = {
  rewardKey: string;
  name: string;
  type: "cashback" | "points" | "gift" | "other";
  amountOrQuantity: string | null;
  unit: string | null;
  scope: "period" | "all_periods" | "overall";
  conditionsText: string;
  overallTarget: CatalogTarget | null;
  acquisition: "automatic" | "manual" | "unknown";
  channel: string | null;
  officialUrl: string | null;
  claimStart: DateValue;
  claimEnd: DateValue;
  expectedReceipt: DateValue;
  receiptRuleText: string;
};
export type CatalogContent = {
  name: string;
  bankId: string | null;
  summary: string;
  activityType: string;
  start: DateValue;
  end: DateValue;
  conditions: {
    cardTypesText: string;
    customerSegmentsText: string;
    regionText: string;
    channelText: string;
    exclusionsText: string;
    enrollmentRequired: "yes" | "no" | "unknown";
    enrollmentScope: "participation" | "period" | "unknown";
    enrollmentDeadline: DateValue;
    quotaText: string;
  };
  periodTemplate: CatalogPeriodTemplate;
  rewards: CatalogRewardTemplate[];
  sources: CatalogOfficialSource[];
  unknownItems: CatalogUnknownItem[];
  bankCancellation: { reason: string; officialSourceUrl: string; verifiedAt: string } | null;
};

export type CatalogRelease = {
  id: string;
  catalogActivityId: string;
  releaseNumber: number;
  activityInstanceKey: string;
  publishedAt: string;
  contentHash: string;
  changeNote: string;
  content: CatalogContent;
};
export type CatalogDraft = {
  id: string;
  catalogActivityId: string;
  version: number;
  basedOnReleaseId: string | null;
  content: CatalogContent;
  updatedAt: string;
};
export type CatalogPersonalLink = {
  participationId: string;
  card: CardIdentity;
  boundReleaseId: string;
  updateAvailable: boolean;
};
export type CatalogParticipationSource = {
  catalogActivityId: string;
  activityInstanceKey: string;
  initialReleaseId: string;
  boundReleaseId: string;
  latestReleaseId: string | null;
  publicationStatus: CatalogPublicationStatus;
  withdrawalReason: string | null;
  noticeId: string | null;
  trackingDecision: "continue" | "stop_future" | "needs_confirmation";
  bankCancellation: CatalogContent["bankCancellation"];
};
export type CatalogSummary = {
  id: string;
  version: number;
  releaseId: string;
  name: string;
  bank: { id: string; name: string };
  phase: CatalogActivityPhase;
  start: DateValue;
  end: DateValue;
  targetText: string;
  rewardText: string;
  nextKeyDate: DateValue;
  sourceStatusText: string;
  unknownItems: CatalogUnknownItem[];
  myParticipations: CatalogPersonalLink[];
  join: { enabled: boolean; reason: string | null };
};
export type CatalogDetail = {
  summary: CatalogSummary;
  release: CatalogRelease;
  publicationStatus: CatalogPublicationStatus;
  withdrawalReason: string | null;
};
export type CatalogFilter = {
  bankIds?: string[];
  activityTypes?: string[];
  phase?: "current" | "upcoming" | "ongoing" | "ended";
  q?: string;
  myBanksOnly?: boolean;
  joinedOnly?: boolean;
  cursor?: string;
};
export type CatalogList = { items: CatalogSummary[]; total: number };
export type CatalogAdminFilter = CatalogFilter & { publicationStatus?: CatalogPublicationStatus };
export type CatalogAdminSummary = {
  id: string;
  version: number;
  publicationStatus: CatalogPublicationStatus;
  currentReleaseId: string | null;
  draftId: string | null;
  name: string;
  bankId: string | null;
  start: DateValue;
  end: DateValue;
  targetText: string;
  rewardText: string;
  lastVerifiedAt: string | null;
  lastModifiedBy: { id: string; displayName: string };
  updatedAt: string;
};
export type CatalogAdminDetail = {
  activity: CatalogAdminSummary;
  draft: CatalogDraft | null;
  releases: CatalogRelease[];
  history: { id: string; actorId: string; action: string; occurredAt: string; releaseId: string | null; note: string; catalogVersion?: number; draftVersion?: number | null }[];
};
export type CatalogDraftPreview = {
  draftId: string;
  draftVersion: number;
  catalogVersion: number;
  contentHash: string;
  content: CatalogContent;
  issues: CatalogValidationIssue[];
  canPublish: boolean;
};

export type CreateCatalogDraftInput = { content: CatalogContent };
export type UpdateCatalogDraftInput = { expectedVersion: number; content: CatalogContent };
export type PublishCatalogDraftInput = {
  draftId: string;
  expectedDraftVersion: number;
  expectedCatalogVersion: number;
  reviewedContentHash: string;
  changeNote: string;
};
export type WithdrawCatalogInput = { expectedVersion: number; reason: string };
export type CatalogAdminCommit = { catalogActivityId: string; version: number; releaseId: string | null; impact: CatalogImpact };

export type CatalogJoinSelection = {
  cardId: string;
  acknowledgedUnknownCodes: string[];
  boundaries: { periodKey: string; startOn: string; endOn: string; timezone: string }[];
  nodePreferences: NodePreference[];
};
export type PreviewCatalogJoinInput = { releaseId: string; selections: CatalogJoinSelection[] };
export type JoinCatalogActivityInput = PreviewCatalogJoinInput & { expectedCatalogVersion: number };
export type CatalogJoinPreview = {
  catalogActivityId: string;
  catalogVersion: number;
  releaseId: string;
  items: { card: CardIdentity; existingParticipationId: string | null; issues: CatalogValidationIssue[]; canActivate: boolean }[];
};
export type CatalogJoinCommit = {
  items: {
    cardId: string;
    participationId: string;
    version: number;
    created: boolean;
    boundReleaseId: string;
    trackingStatus: "needs_review" | "planned" | "active";
  }[];
  impact: CatalogImpact;
};
export type CatalogRuleDiff = {
  participationId: string;
  participationVersion: number;
  boundReleaseId: string;
  targetReleaseId: string;
  changes: { field: string; beforeText: string; afterText: string; affects: "source" | "current_period" | "future_periods" | "rewards" | "dates" }[];
};
export type AdoptCatalogReleaseInput = {
  expectedVersion: number;
  targetReleaseId: string;
  affectedFuturePeriodIds: string[];
  currentPeriodDecisions: { periodId: string; expectedVersion: number; decision: "keep_frozen" | "create_review_revision"; note: string }[];
  note: string;
};
export type CatalogAdoptionCommit = { participationId: string; version: number; boundReleaseId: string; impact: CatalogImpact };
export type DecideCatalogTrackingInput = {
  expectedVersion: number;
  noticeId: string;
  decision: "continue" | "stop_future";
  rewardReminderPolicy: "continue" | "stop" | "needs_confirmation";
  note: string;
};
export type CatalogWorkflowResult<T> = CommandResult<T>;
export type CatalogErrorReason =
  | "CATALOG_VERSION_CONFLICT"
  | "CATALOG_NOT_JOINABLE"
  | "DRAFT_CHANGED"
  | "PUBLICATION_BLOCKED"
  | "PERIOD_REVISION_REQUIRED";
