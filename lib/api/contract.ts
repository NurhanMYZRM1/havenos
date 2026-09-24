/**
 * The single contract between the desktop main process (which owns the
 * database, the attachment folder, dialogs and credentials) and the UI.
 *
 * The UI never touches SQLite or the filesystem. It calls
 * `window.havenos.invoke(method, params)`; main validates `params` again,
 * runs the operation, and answers with `ApiResponse<Result>`.
 *
 * Keep this file free of runtime imports other than types — it is compiled
 * into both the Next.js bundle and the Electron main process.
 */

import type { IsoDate, YearMonth } from "../domain/dates";
import type {
  AttachmentPurpose,
  BlockReason,
  ChannelId,
  ChannelMethod,
  ChargeKind,
  ChargeState,
  DepositEntryKind,
  DepositType,
  ExportDataset,
  LedgerKind,
  MaintenanceCategory,
  MaintenancePriority,
  MaintenanceStatus,
  MyState,
  PaymentMethod,
  PropertyType,
  RentalMode,
  ReservationChannel,
  ReservationSource,
  ReservationStatus,
  RoomType,
  SpaceKind,
  StayExpenseCategory,
  TenancyStatus,
  TurnoverStatus,
} from "../domain/enums";
import type { Sen } from "../domain/money";
import type { MessageKey } from "../i18n";

export type ID = string;

// ── Errors ─────────────────────────────────────────────────────────────────

export type ErrorCode =
  | "VALIDATION"
  | "CONFLICT"
  | "NOT_FOUND"
  | "NOT_ALLOWED"
  | "BACKUP_INVALID"
  | "CLOUD_NOT_CONFIGURED"
  | "CLOUD_AUTH"
  | "CLOUD_CONSENT"
  | "CLOUD_ENTITLEMENT"
  | "CLOUD_NETWORK"
  | "CLOUD_SERVER"
  | "UNSUPPORTED"
  | "INTERNAL";

export interface ApiErrorShape {
  code: ErrorCode;
  /** English fallback, always present. */
  message: string;
  messageKey?: MessageKey;
  params?: Record<string, string | number>;
  /** Field path → message key, for forms. */
  fields?: Record<string, MessageKey>;
}

export type ApiResponse<T> = { ok: true; data: T } | { ok: false; error: ApiErrorShape };

// ── App & settings ─────────────────────────────────────────────────────────

export type Workspace = "main" | "sample";

export interface AppInfo {
  appVersion: string;
  platform: string;
  isPackaged: boolean;
  workspace: Workspace;
  dataDir: string;
  dbPath: string;
  schemaVersion: number;
  dbSizeBytes: number;
  attachmentCount: number;
  attachmentBytes: number;
  today: IsoDate;
}

export interface Settings {
  landlordName: string;
  contactPhone: string;
  contactEmail: string;
  address: string;
  receiptNote: string;
  lastLocalBackupAt: string | null;
}

export type SettingsInput = Omit<Settings, "lastLocalBackupAt">;

// ── Attachments ────────────────────────────────────────────────────────────

export type AttachmentOwnerKind = "property" | "maintenance" | "tenancy" | "tenant" | "payment" | "draft" | "turnover" | "staging";

export interface AttachmentOwner {
  kind: AttachmentOwnerKind;
  id: ID;
}

export interface Attachment {
  id: ID;
  purpose: AttachmentPurpose;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  caption: string;
  sortOrder: number;
  createdAt: string;
  /** Served by the desktop app's private `havenos-file:` protocol. */
  url: string;
  thumbUrl: string;
  isImage: boolean;
}

export interface DroppedFile {
  name: string;
  bytes: Uint8Array;
}

// ── Properties & inventory ─────────────────────────────────────────────────

export interface PropertyInput {
  name: string;
  propertyType: PropertyType;
  addressLine1: string;
  addressLine2: string;
  postcode: string;
  city: string;
  state: MyState;
  notes: string;
  rentDueDay: number;
  /** Deposit multipliers in tenths of a month: 20 = 2 months. */
  securityDepositTenths: number;
  utilityDepositTenths: number;
  defaultTenancyMonths: number;
  defaultTerms: string;
}

export type OccupancyState = "vacant" | "let" | "upcoming" | "part_let" | "covered";

export interface SpaceOccupancy {
  state: OccupancyState;
  tenancyId: ID | null;
  tenantName: string | null;
  until: IsoDate | null;
  nextStart: IsoDate | null;
}

export interface SpaceNode {
  id: ID;
  propertyId: ID;
  kind: SpaceKind;
  parentId: ID | null;
  label: string;
  /** "A-12-3 › Master bedroom › Bed 1" */
  path: string;
  rentalMode: RentalMode | null;
  floor: string;
  sizeSqft: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  roomType: RoomType | null;
  defaultRentSen: Sen;
  notes: string;
  archived: boolean;
  lettable: boolean;
  occupancy: SpaceOccupancy;
  children: SpaceNode[];
}

export interface PropertySummary {
  id: ID;
  name: string;
  propertyType: PropertyType;
  addressLine1: string;
  city: string;
  postcode: string;
  state: MyState;
  cover: Attachment | null;
  unitCount: number;
  lettable: number;
  occupied: number;
  rentalModes: RentalMode[];
  openMaintenance: number;
  archived: boolean;
  createdAt: string;
}

export interface PropertyDetail extends PropertyInput {
  id: ID;
  units: SpaceNode[];
  photos: Attachment[];
  lettable: number;
  occupied: number;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SpaceInput {
  propertyId: ID;
  parentId: ID | null;
  kind: SpaceKind;
  label: string;
  rentalMode: RentalMode | null;
  floor: string;
  sizeSqft: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  roomType: RoomType | null;
  defaultRentSen: Sen;
  notes: string;
}

export type SpaceUpdate = Omit<SpaceInput, "propertyId" | "parentId" | "kind"> & { id: ID };

/** A lettable space with its availability for a proposed date range. */
export interface SpaceOption {
  id: ID;
  propertyId: ID;
  propertyName: string;
  kind: SpaceKind;
  path: string;
  defaultRentSen: Sen;
  /** Matches the unit's usual arrangement (whole unit / by room / by bed). */
  lettable: boolean;
  available: boolean;
  conflict: string | null;
}

// ── Onboarding drafts ──────────────────────────────────────────────────────

export interface DraftBed {
  key: string;
  label: string;
}

export interface DraftRoom {
  key: string;
  label: string;
  roomType: RoomType;
  beds: DraftBed[];
}

export interface DraftUnit {
  key: string;
  label: string;
  floor: string;
  sizeSqft: string;
  bedrooms: string;
  rentalMode: RentalMode;
  rooms: DraftRoom[];
}

/** Raw form state, saved as typed so a half-finished draft survives a restart. */
export interface OnboardingDraftData {
  details: {
    name: string;
    propertyType: PropertyType | "";
    addressLine1: string;
    addressLine2: string;
    postcode: string;
    city: string;
    state: MyState | "";
    notes: string;
  };
  arrangement: {
    defaultMode: RentalMode | "";
    units: DraftUnit[];
  };
  rent: {
    rentDueDay: string;
    securityDepositMonths: string;
    utilityDepositMonths: string;
    defaultTenancyMonths: string;
    defaultTerms: string;
    /** Keyed by DraftUnit/DraftRoom/DraftBed key. */
    rents: Record<string, string>;
  };
}

export interface OnboardingDraft {
  id: ID;
  step: number;
  data: OnboardingDraftData;
  photos: Attachment[];
  updatedAt: string;
}

// ── Tenants & tenancies ────────────────────────────────────────────────────

export interface TenantInput {
  fullName: string;
  phone: string;
  email: string;
  emergencyName: string;
  emergencyPhone: string;
  notes: string;
}

export interface Tenant extends TenantInput {
  id: ID;
  createdAt: string;
  currentTenancies: number;
  balanceSen: Sen;
}

export interface TenantDetail extends Tenant {
  tenancies: TenancySummary[];
  documents: Attachment[];
}

export interface TenancyInput {
  tenantId: ID;
  spaceId: ID;
  startDate: IsoDate;
  endDate: IsoDate | null;
  monthlyRentSen: Sen;
  rentDueDay: number;
  rentStartMonth: YearMonth;
  securityDepositSen: Sen;
  utilityDepositSen: Sen;
  terms: string;
}

export type TenancyCreate = Omit<TenancyInput, "tenantId"> & {
  tenantId: ID | null;
  newTenant: TenantInput | null;
  stagingKey: string | null;
};

export type TenancyUpdate = Omit<TenancyInput, "tenantId" | "spaceId" | "monthlyRentSen" | "rentDueDay" | "rentStartMonth"> & {
  id: ID;
};

export interface TenancySummary {
  id: ID;
  ref: string;
  tenantId: ID;
  tenantName: string;
  tenantPhone: string;
  propertyId: ID;
  propertyName: string;
  spaceId: ID;
  spaceKind: SpaceKind;
  spacePath: string;
  startDate: IsoDate;
  endDate: IsoDate | null;
  movedInOn: IsoDate | null;
  movedOutOn: IsoDate | null;
  cancelledAt: string | null;
  status: TenancyStatus;
  needsMoveIn: boolean;
  needsMoveOut: boolean;
  monthlyRentSen: Sen;
  rentDueDay: number;
  balanceSen: Sen;
  overdueSen: Sen;
}

export interface ScheduleEntry {
  id: ID;
  effectiveMonth: YearMonth;
  amountSen: Sen;
  dueDay: number;
}

export interface Charge {
  id: ID;
  tenancyId: ID;
  kind: ChargeKind;
  period: YearMonth | null;
  description: string;
  amountSen: Sen;
  paidSen: Sen;
  balanceSen: Sen;
  dueDate: IsoDate;
  state: ChargeState;
  voidedAt: string | null;
  voidReason: string;
  createdAt: string;
}

export interface Payment {
  id: ID;
  tenancyId: ID;
  receiptNo: string;
  receivedOn: IsoDate;
  amountSen: Sen;
  method: PaymentMethod;
  reference: string;
  description: string;
  notes: string;
  voidedAt: string | null;
  voidReason: string;
  createdAt: string;
  attachments: Attachment[];
}

export interface DepositEntry {
  id: ID;
  tenancyId: ID;
  depositType: DepositType;
  kind: DepositEntryKind;
  amountSen: Sen;
  occurredOn: IsoDate;
  method: PaymentMethod | null;
  reference: string;
  notes: string;
  voidedAt: string | null;
  createdAt: string;
}

export interface DepositSummary {
  agreedSecuritySen: Sen;
  agreedUtilitySen: Sen;
  receivedSen: Sen;
  refundedSen: Sen;
  deductedSen: Sen;
  heldSen: Sen;
  entries: DepositEntry[];
}

export interface TenancyDetail extends TenancySummary {
  terms: string;
  rentStartMonth: YearMonth;
  securityDepositSen: Sen;
  utilityDepositSen: Sen;
  moveInNotes: string;
  moveOutNotes: string;
  schedule: ScheduleEntry[];
  charges: Charge[];
  payments: Payment[];
  creditSen: Sen;
  deposits: DepositSummary;
  documents: Attachment[];
  createdAt: string;
}

export interface MoveInInput {
  id: ID;
  movedInOn: IsoDate;
  notes: string;
  depositReceived: { depositType: DepositType; amountSen: Sen; method: PaymentMethod; reference: string }[];
}

export interface MoveOutInput {
  id: ID;
  movedOutOn: IsoDate;
  notes: string;
  voidChargesAfterMoveOut: boolean;
  deposit: { refundSen: Sen; deductSen: Sen; deductReason: string; method: PaymentMethod | null; reference: string } | null;
}

export type TenancyFilter = "current" | TenancyStatus | "all";

// ── Rent ───────────────────────────────────────────────────────────────────

export interface ChargeInput {
  tenancyId: ID;
  kind: Exclude<ChargeKind, "rent">;
  description: string;
  amountSen: Sen;
  dueDate: IsoDate;
}

export interface ChargeUpdate {
  id: ID;
  description: string;
  amountSen: Sen;
  dueDate: IsoDate;
}

export interface PaymentInput {
  tenancyId: ID;
  receivedOn: IsoDate;
  amountSen: Sen;
  method: PaymentMethod;
  reference: string;
  description: string;
  notes: string;
  stagingKey: string | null;
}

export interface DepositInput {
  tenancyId: ID;
  depositType: DepositType;
  kind: DepositEntryKind;
  amountSen: Sen;
  occurredOn: IsoDate;
  method: PaymentMethod | null;
  reference: string;
  notes: string;
}

export interface ScheduleChangeInput {
  tenancyId: ID;
  effectiveMonth: YearMonth;
  amountSen: Sen;
  dueDay: number;
  /** Also update charges already created for that month onwards, if unpaid. */
  applyToUnpaid: boolean;
}

export interface RentRow {
  chargeId: ID | null;
  tenancyId: ID;
  tenantName: string;
  propertyName: string;
  spacePath: string;
  description: string;
  dueDate: IsoDate;
  amountSen: Sen;
  paidSen: Sen;
  balanceSen: Sen;
  state: ChargeState;
}

export interface PaymentListItem {
  id: ID;
  tenancyId: ID;
  receiptNo: string;
  receivedOn: IsoDate;
  amountSen: Sen;
  method: PaymentMethod;
  reference: string;
  tenantName: string;
  spacePath: string;
  voided: boolean;
}

export interface RentMonthView {
  month: YearMonth;
  today: IsoDate;
  /** Future month: rows are the schedule's plan, no charges exist yet. */
  projected: boolean;
  totals: {
    expectedSen: Sen;
    collectedSen: Sen;
    outstandingSen: Sen;
    overdueSen: Sen;
    receivedInMonthSen: Sen;
  };
  rows: RentRow[];
  payments: PaymentListItem[];
}

export interface ReceiptView {
  payment: Payment;
  tenantName: string;
  tenantPhone: string;
  propertyName: string;
  propertyAddress: string;
  spacePath: string;
  tenancyRef: string;
  landlord: Settings;
}

// ── Maintenance ────────────────────────────────────────────────────────────

export interface MaintenanceInput {
  propertyId: ID;
  spaceId: ID | null;
  tenantId: ID | null;
  title: string;
  description: string;
  category: MaintenanceCategory;
  priority: MaintenancePriority;
  status: MaintenanceStatus;
  dueDate: IsoDate | null;
  assigneeName: string;
  assigneePhone: string;
  estimatedCostSen: Sen | null;
  actualCostSen: Sen | null;
  reportedOn: IsoDate;
}

export type MaintenanceCreate = MaintenanceInput & { stagingKey: string | null };

export interface MaintenanceItem extends MaintenanceInput {
  id: ID;
  ref: string;
  propertyName: string;
  spacePath: string | null;
  tenantName: string | null;
  overdue: boolean;
  photoCount: number;
  completedOn: IsoDate | null;
  createdAt: string;
  updatedAt: string;
}

export type MaintenanceField = keyof MaintenanceInput;

export interface MaintenanceEvent {
  id: ID;
  kind: "created" | "updated" | "note" | "attachment_added" | "attachment_removed";
  changes: { field: MaintenanceField; from: string | number | null; to: string | number | null }[];
  note: string;
  createdAt: string;
}

export interface MaintenanceDetail extends MaintenanceItem {
  photos: Attachment[];
  events: MaintenanceEvent[];
}

export interface MaintenanceFilter {
  propertyId: ID | null;
  status: MaintenanceStatus | "open" | "all";
  priority: MaintenancePriority | null;
  overdueOnly: boolean;
  query: string;
}

// ── Dashboard & search ─────────────────────────────────────────────────────

export interface DashboardSummary {
  today: IsoDate;
  month: YearMonth;
  counts: { properties: number; tenants: number; currentTenancies: number };
  occupancy: {
    lettable: number;
    occupied: number;
    byKind: Record<SpaceKind, { total: number; occupied: number }>;
  };
  rent: {
    expectedSen: Sen;
    collectedSen: Sen;
    outstandingSen: Sen;
    overdueInMonthSen: Sen;
    overdueAllSen: Sen;
    receivedInMonthSen: Sen;
  };
  depositsHeldSen: Sen;
  endingSoon: TenancySummary[];
  moveIns: TenancySummary[];
  moveOuts: TenancySummary[];
  needsAttention: TenancySummary[];
  maintenance: {
    open: number;
    overdue: number;
    urgent: number;
    byStatus: Record<MaintenanceStatus, number>;
    top: MaintenanceItem[];
  };
  lastLocalBackupAt: string | null;
}

export type SearchKind = "property" | "space" | "tenant" | "tenancy" | "maintenance" | "payment";

export interface SearchResult {
  kind: SearchKind;
  id: ID;
  title: string;
  subtitle: string;
  href: string;
}

// ── Backup ─────────────────────────────────────────────────────────────────

export interface BackupSummary {
  fileName: string;
  createdAt: string;
  appVersion: string;
  schemaVersion: number;
  counts: Record<string, number>;
  attachmentCount: number;
  sizeBytes: number;
}

export interface BackupInspection {
  token: string;
  summary: BackupSummary;
}

export interface SafetyBackup {
  path: string;
  fileName: string;
  createdAt: string;
  sizeBytes: number;
}

// ── Cloud backup (optional paid service) ───────────────────────────────────

export type EntitlementStatus = "none" | "active" | "grace" | "expired";

export interface CloudEntitlement {
  status: EntitlementStatus;
  plan: string | null;
  currentPeriodEnd: string | null;
  canUpload: boolean;
  canDownload: boolean;
  checkedAt: string;
}

export interface CloudProgress {
  operation: "backup" | "restore";
  phase: "preparing" | "uploading" | "finalizing" | "downloading" | "verifying" | "done" | "error";
  bytesDone: number;
  bytesTotal: number;
  error: string | null;
}

export interface CloudStatus {
  configured: boolean;
  credentialStorage: "os" | "unavailable";
  signedIn: boolean;
  email: string | null;
  optedIn: boolean;
  optedInAt: string | null;
  entitlement: CloudEntitlement | null;
  entitlementError: string | null;
  lastSuccessAt: string | null;
  lastAttempt: { at: string; ok: boolean; error: string | null } | null;
  progress: CloudProgress | null;
}

export interface CloudBackupItem {
  id: ID;
  createdAt: string;
  sizeBytes: number;
  appVersion: string;
  counts: Record<string, number>;
}

// ── Short stays: channel connections ───────────────────────────────────────
// See docs/short-stays.md. Today every connection is a calendar (iCal) feed:
// dates only — no guest details, prices, payouts or listing content — and
// HavenOS can't write to the channel. The UI must describe a connection by its
// `capabilities`, never assume more.

export interface ChannelCapabilities {
  method: ChannelMethod;
  /** False: every sync reads the whole calendar and changes are inferred. */
  incremental: boolean;
  /** False: HavenOS can't block dates on the channel; the landlord does it by hand. */
  pushAvailability: boolean;
  /** False: no guest names or contact details. */
  guestDetails: boolean;
  /** False: no prices, fees or payouts. */
  money: boolean;
  /** How long the channel itself may take to pick up dates blocked there from another calendar. */
  channelImportDelayMinutes: number | null;
}

export type ChannelHealth = "ok" | "syncing" | "stale" | "error" | "paused" | "never_synced" | "feed_link_missing";

export type ChannelErrorCode =
  | "offline"
  | "timeout"
  | "http_error"
  | "not_found"
  | "forbidden"
  | "rate_limited"
  | "not_a_calendar"
  | "too_large"
  | "feed_shrank"
  | "feed_link_missing"
  | "credential_store"
  | "internal";

export type ChannelSyncTrigger = "launch" | "timer" | "manual" | "setup";

export interface ChannelConnection {
  id: ID;
  channel: ChannelId;
  method: ChannelMethod;
  name: string;
  externalListingId: string | null;
  propertyId: ID;
  propertyName: string;
  spaceId: ID;
  spacePath: string;
  spaceKind: SpaceKind;
  status: "active" | "paused";
  health: ChannelHealth;
  capabilities: ChannelCapabilities;
  hasFeedLink: boolean;
  /** Safe description of the link, e.g. "airbnb.com · listing …4821". Never the link itself. */
  feedLinkHint: string | null;
  checkInTime: string;
  checkOutTime: string;
  turnoverChecklist: string[];
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  /** When HavenOS will next read the feed, if the app stays open. */
  nextSyncAt: string | null;
  lastError: { code: ChannelErrorCode; detail: string; at: string } | null;
  stale: boolean;
  counts: { upcoming: number; conflicts: number; missing: number; pendingBlocks: number };
  createdAt: string;
  updatedAt: string;
}

export interface ChannelSyncRun {
  id: ID;
  trigger: ChannelSyncTrigger;
  startedAt: string;
  finishedAt: string | null;
  outcome: "ok" | "failed" | "rejected" | null;
  errorCode: ChannelErrorCode | null;
  eventsSeen: number;
  created: number;
  updated: number;
  missing: number;
  conflicts: number;
}

/** A HavenOS record that clashes with a channel booking. */
export interface ConflictInfo {
  kind: "tenancy" | "reservation" | "block";
  id: ID;
  spaceId: ID;
  spacePath: string;
  /** Tenant name, guest name / channel, or block reason. */
  who: string;
  start: IsoDate;
  /** Last occupied day (inclusive); null for an open-ended tenancy. */
  end: IsoDate | null;
  channel: ReservationChannel | null;
  /** HavenOS may cancel it for the landlord (a manual block or direct reservation). */
  replaceable: boolean;
  href: string;
}

export type ChannelEventAction = "retry" | "dismiss" | "replace";

export interface ChannelEventView {
  id: ID;
  connectionId: ID;
  connectionName: string;
  kind: "reservation" | "block";
  confirmationCode: string | null;
  /** Dates as the channel lists them (check-out exclusive). */
  checkIn: IsoDate;
  checkOut: IsoDate;
  state: "applied" | "conflict" | "dismissed";
  reservationId: ID | null;
  /** For a date change that couldn't be applied: the dates HavenOS still holds. */
  currentDates: { checkIn: IsoDate; checkOut: IsoDate } | null;
  conflicts: ConflictInfo[];
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface ChannelConnectionDetail extends ChannelConnection {
  runs: ChannelSyncRun[];
  /** Conflicts and dismissed conflicts (applied events aren't listed). */
  events: ChannelEventView[];
  missingReservations: ReservationSummary[];
}

export interface ChannelConnectionCreate {
  channel: ChannelId;
  name: string;
  spaceId: ID;
  feedUrl: string;
  checkInTime: string;
  checkOutTime: string;
}

export interface ChannelConnectionUpdate {
  id: ID;
  name: string;
  spaceId: ID;
  /** null keeps the stored link. */
  feedUrl: string | null;
  checkInTime: string;
  checkOutTime: string;
  turnoverChecklist: string[];
}

/** Dates HavenOS knows are taken that the channel's calendar still shows as open. */
export interface PendingBlock {
  connectionId: ID;
  connectionName: string;
  channel: ChannelId;
  spaceId: ID;
  spacePath: string;
  /** First and last night to block (inclusive). */
  start: IsoDate;
  end: IsoDate;
  reasons: { kind: "tenancy" | "reservation" | "block"; label: string; href: string }[];
  acknowledgedAt: string | null;
}

// ── Short stays: reservations, blocks, turnovers ───────────────────────────

export interface ReservationSummary {
  id: ID;
  propertyId: ID;
  propertyName: string;
  spaceId: ID;
  spacePath: string;
  spaceKind: SpaceKind;
  channel: ReservationChannel;
  channelReservationId: string | null;
  connectionId: ID | null;
  connectionName: string | null;
  source: ReservationSource;
  /** Empty when the channel doesn't share it (calendar feeds). */
  guestName: string;
  guestCount: number | null;
  checkIn: IsoDate;
  /** Exclusive: the check-out day is free for the next arrival. */
  checkOut: IsoDate;
  checkInTime: string | null;
  checkOutTime: string | null;
  nights: number;
  status: ReservationStatus;
  /** The channel feed stopped listing it; it may have been cancelled. */
  missingSince: string | null;
  lastSeenAt: string | null;
  /** Dates come from a channel feed and can only be changed on the channel. */
  datesLocked: boolean;
  turnoverId: ID | null;
  turnoverStatus: TurnoverStatus | null;
  createdAt: string;
  updatedAt: string;
}

export interface ReservationEvent {
  id: ID;
  kind: "created" | "updated" | "dates_changed" | "cancelled" | "missing" | "reappeared" | "conflict" | "note";
  source: ReservationSource;
  changes: { field: string; from: string | number | null; to: string | number | null }[];
  note: string;
  createdAt: string;
}

export interface ReservationDetail extends ReservationSummary {
  notes: string;
  cancelledAt: string | null;
  cancelReason: string;
  events: ReservationEvent[];
  ledger: LedgerEntry[];
}

export interface ReservationCreate {
  spaceId: ID;
  guestName: string;
  guestCount: number | null;
  checkIn: IsoDate;
  checkOut: IsoDate;
  checkInTime: string | null;
  checkOutTime: string | null;
  status: "tentative" | "confirmed";
  channel: ReservationChannel;
  channelReservationId: string | null;
  notes: string;
}

/** For synced reservations only guest details, times and notes can change. */
export type ReservationUpdate = Omit<ReservationCreate, "spaceId" | "channel" | "channelReservationId"> & { id: ID };

export interface ReservationFilter {
  from: IsoDate;
  to: IsoDate;
  propertyId: ID | null;
  spaceId: ID | null;
  includeCancelled: boolean;
}

export interface AvailabilityBlockInput {
  spaceId: ID;
  startDate: IsoDate;
  /** Last blocked night (inclusive). */
  endDate: IsoDate;
  reason: BlockReason;
  maintenanceId: ID | null;
  notes: string;
}

export interface AvailabilityBlock extends AvailabilityBlockInput {
  id: ID;
  propertyId: ID;
  propertyName: string;
  spacePath: string;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ChecklistItem {
  label: string;
  done: boolean;
}

export interface TurnoverItem {
  id: ID;
  reservationId: ID;
  propertyId: ID;
  propertyName: string;
  spaceId: ID;
  spacePath: string;
  guestName: string;
  channel: ReservationChannel;
  dueDate: IsoDate;
  checkoutTime: string;
  nextCheckIn: { reservationId: ID; date: IsoDate; time: string | null; guestName: string } | null;
  /** Hours between this check-out and the next check-in, if there is one. */
  windowHours: number | null;
  status: TurnoverStatus;
  assigneeName: string;
  assigneePhone: string;
  checklist: ChecklistItem[];
  costSen: Sen | null;
  notes: string;
  completedAt: string | null;
  photoCount: number;
  unassigned: boolean;
  /** Not done and past the next check-in (or the end of its due day). */
  late: boolean;
}

export interface TurnoverDetail extends TurnoverItem {
  photos: Attachment[];
}

export interface TurnoverUpdate {
  id: ID;
  status: TurnoverStatus;
  assigneeName: string;
  assigneePhone: string;
  checkoutTime: string;
  checklist: ChecklistItem[];
  costSen: Sen | null;
  notes: string;
}

export interface TurnoverFilter {
  from: IsoDate | null;
  to: IsoDate | null;
  status: TurnoverStatus | "open" | "all";
  propertyId: ID | null;
}

// ── Short stays: day view, calendar, alerts ────────────────────────────────

export type StayAlertKind =
  | "conflict"
  | "missing_from_feed"
  | "unassigned_turnover"
  | "late_turnover"
  | "stale_feed"
  | "sync_failed"
  | "arrival_with_critical_maintenance"
  | "block_not_on_channel";

export interface StayAlert {
  /** Stable, e.g. "late_turnover:<id>". */
  id: string;
  kind: StayAlertKind;
  severity: "critical" | "warning" | "info";
  date: IsoDate | null;
  propertyName: string;
  spacePath: string | null;
  /** Interpolated into the UI's message for `kind`. */
  params: Record<string, string | number>;
  href: string;
}

export interface StayDay {
  date: IsoDate;
  today: IsoDate;
  arrivals: ReservationSummary[];
  departures: ReservationSummary[];
  inHouse: ReservationSummary[];
  /** Due on `date`, plus any still open from earlier days. */
  turnovers: TurnoverItem[];
  /** Open maintenance on spaces or properties with short stays. */
  maintenance: MaintenanceItem[];
  alerts: StayAlert[];
  channels: { total: number; active: number; stale: number; failing: number; oldestSuccessAt: string | null };
}

export type CalendarItemKind = "reservation" | "block" | "channel_block" | "tenancy" | "conflict";

export interface CalendarItem {
  kind: CalendarItemKind;
  id: ID;
  /** Nights [start, endExclusive), whatever the record's own convention. */
  start: IsoDate;
  endExclusive: IsoDate;
  label: string;
  status: ReservationStatus | null;
  channel: ReservationChannel | null;
  missing: boolean;
  /** Set when the record sits on a containing or contained space. */
  viaSpacePath: string | null;
  href: string | null;
}

export interface CalendarRow {
  spaceId: ID;
  propertyId: ID;
  propertyName: string;
  spacePath: string;
  spaceKind: SpaceKind;
  connection: { id: ID; name: string; channel: ChannelId; health: ChannelHealth } | null;
  items: CalendarItem[];
}

export interface StayCalendar {
  from: IsoDate;
  to: IsoDate;
  today: IsoDate;
  rows: CalendarRow[];
}

// ── Short stays: money ─────────────────────────────────────────────────────

export type AmountSource = "imported" | "entered";

export interface LedgerInput {
  reservationId: ID | null;
  propertyId: ID;
  spaceId: ID | null;
  channel: ReservationChannel;
  kind: LedgerKind;
  /** Negative only for adjustments. */
  amountSen: Sen;
  occurredOn: IsoDate;
  category: StayExpenseCategory | "";
  description: string;
}

export interface LedgerEntry extends LedgerInput {
  id: ID;
  source: AmountSource;
  importId: ID | null;
  propertyName: string;
  spacePath: string | null;
  voidedAt: string | null;
  createdAt: string;
}

export type StayImportKind = "airbnb_transactions" | "airbnb_reservations";

export interface CsvImportPreview {
  token: ID;
  kind: StayImportKind;
  fileName: string;
  rowsTotal: number;
  rowsUsable: number;
  rowsSkipped: number;
  /** Rows already imported from an earlier file (skipped on commit). */
  duplicates: number;
  /** Listing names in the file; the landlord maps each to a space (or skips it). */
  listings: { name: string; rows: number; suggestedSpaceId: ID | null }[];
  matchedReservations: number;
  newReservations: number;
  currency: string | null;
  warnings: string[];
}

export interface CsvImportResult {
  importId: ID;
  rowsImported: number;
  rowsSkipped: number;
  duplicates: number;
  reservationsCreated: number;
  reservationsUpdated: number;
  ledgerEntries: number;
  /** Rows whose stay clashes with another HavenOS record; money was kept, the stay wasn't created. */
  conflicts: { confirmationCode: string; message: string }[];
}

export type PerformanceGroup = "property" | "space" | "channel" | "month";

/** Imported (from a channel export) and entered (typed by the landlord) kept apart. */
export interface PerformanceFigure {
  importedSen: Sen;
  enteredSen: Sen;
  totalSen: Sen;
}

export interface PerformanceRow {
  key: string;
  label: string;
  stays: number;
  nights: number;
  /** Booked nights ÷ nights in range, for rows that are one space; else null. */
  occupancyPct: number | null;
  bookingValue: PerformanceFigure;
  cleaningFees: PerformanceFigure;
  channelFees: PerformanceFigure;
  taxes: PerformanceFigure;
  payouts: PerformanceFigure;
  expenses: PerformanceFigure;
  /** bookingValue − channelFees − taxes − expenses. An estimate, not accounting. */
  estimatedNetSen: Sen;
  /** Booking value ÷ nights, for stays with a booking value. */
  averageNightlySen: Sen | null;
  /** Stays with no booking value recorded (e.g. synced from a calendar only). */
  staysWithoutMoney: number;
}

export interface PerformanceReport {
  from: YearMonth;
  to: YearMonth;
  groupBy: PerformanceGroup;
  rows: PerformanceRow[];
  totals: PerformanceRow;
}

// ── Method map ─────────────────────────────────────────────────────────────

export interface ApiSpec {
  "app.info": [void, AppInfo];
  "app.openDataFolder": [void, null];
  "app.openExternal": [{ url: string }, null];
  "workspace.switch": [{ workspace: Workspace; reset?: boolean }, AppInfo];

  "settings.get": [void, Settings];
  "settings.update": [SettingsInput, Settings];

  "properties.list": [{ includeArchived: boolean }, PropertySummary[]];
  "properties.get": [{ id: ID }, PropertyDetail];
  "properties.update": [PropertyInput & { id: ID }, PropertyDetail];
  "properties.setArchived": [{ id: ID; archived: boolean }, PropertyDetail];
  "properties.delete": [{ id: ID }, null];

  "spaces.create": [SpaceInput, PropertyDetail];
  "spaces.update": [SpaceUpdate, PropertyDetail];
  "spaces.setArchived": [{ id: ID; archived: boolean }, PropertyDetail];
  "spaces.options": [{ propertyId: ID | null; startDate: IsoDate | null; endDate: IsoDate | null; excludeTenancyId: ID | null }, SpaceOption[]];

  "drafts.current": [void, OnboardingDraft | null];
  "drafts.save": [{ id: ID | null; step: number; data: OnboardingDraftData }, OnboardingDraft];
  "drafts.discard": [{ id: ID }, null];
  "drafts.complete": [{ id: ID }, { propertyId: ID }];

  "tenants.list": [{ query: string }, Tenant[]];
  "tenants.get": [{ id: ID }, TenantDetail];
  "tenants.create": [TenantInput, Tenant];
  "tenants.update": [TenantInput & { id: ID }, Tenant];

  "tenancies.list": [{ filter: TenancyFilter; propertyId: ID | null; tenantId: ID | null }, TenancySummary[]];
  "tenancies.get": [{ id: ID }, TenancyDetail];
  "tenancies.create": [TenancyCreate, TenancyDetail];
  "tenancies.update": [TenancyUpdate, TenancyDetail];
  "tenancies.moveIn": [MoveInInput, TenancyDetail];
  "tenancies.moveOut": [MoveOutInput, TenancyDetail];
  "tenancies.cancel": [{ id: ID; reason: string }, TenancyDetail];
  "tenancies.delete": [{ id: ID }, null];

  "rent.month": [{ month: YearMonth }, RentMonthView];
  "rent.setSchedule": [ScheduleChangeInput, TenancyDetail];
  "rent.addCharge": [ChargeInput, TenancyDetail];
  "rent.updateCharge": [ChargeUpdate, TenancyDetail];
  "rent.voidCharge": [{ id: ID; reason: string }, TenancyDetail];
  "rent.recordPayment": [PaymentInput, Payment];
  "rent.voidPayment": [{ id: ID; reason: string }, TenancyDetail];
  "rent.receipt": [{ paymentId: ID }, ReceiptView];
  "rent.saveReceiptPdf": [{ paymentId: ID }, { path: string } | null];
  "deposits.record": [DepositInput, TenancyDetail];
  "deposits.void": [{ id: ID }, TenancyDetail];

  "maintenance.list": [MaintenanceFilter, MaintenanceItem[]];
  "maintenance.get": [{ id: ID }, MaintenanceDetail];
  "maintenance.create": [MaintenanceCreate, MaintenanceDetail];
  "maintenance.update": [MaintenanceInput & { id: ID }, MaintenanceDetail];
  "maintenance.addNote": [{ id: ID; note: string }, MaintenanceDetail];

  "attachments.pick": [{ owner: AttachmentOwner; purpose: AttachmentPurpose }, Attachment[] | null];
  "attachments.importDropped": [{ owner: AttachmentOwner; purpose: AttachmentPurpose; files: DroppedFile[] }, Attachment[]];
  "attachments.list": [{ owner: AttachmentOwner }, Attachment[]];
  "attachments.reorder": [{ owner: AttachmentOwner; orderedIds: ID[] }, Attachment[]];
  "attachments.remove": [{ id: ID }, null];
  "attachments.open": [{ id: ID }, null];
  "attachments.saveAs": [{ id: ID }, { path: string } | null];

  "dashboard.summary": [{ month: YearMonth }, DashboardSummary];
  "search.query": [{ query: string }, SearchResult[]];

  "export.dataset": [{ dataset: ExportDataset }, { path: string } | null];
  "export.all": [void, { folder: string; files: number } | null];

  "backup.create": [void, { path: string; summary: BackupSummary } | null];
  "backup.pickAndInspect": [void, BackupInspection | null];
  "backup.inspectSafety": [{ path: string }, BackupInspection];
  "backup.restore": [{ token: ID }, { safetyBackupPath: string }];
  "backup.discardInspection": [{ token: ID }, null];
  "backup.listSafety": [void, SafetyBackup[]];

  "cloud.status": [{ refresh: boolean }, CloudStatus];
  "cloud.requestCode": [{ email: string }, CloudStatus];
  "cloud.verifyCode": [{ email: string; code: string }, CloudStatus];
  "cloud.signOut": [void, CloudStatus];
  "cloud.setOptIn": [{ optedIn: boolean; consent: boolean }, CloudStatus];
  "cloud.backupNow": [void, CloudStatus];
  "cloud.list": [void, CloudBackupItem[]];
  "cloud.restore": [{ id: ID }, BackupInspection];
  "cloud.openCheckout": [{ plan: "monthly" | "annual" }, null];
  "cloud.openBillingPortal": [void, null];

  "channels.list": [void, ChannelConnection[]];
  "channels.get": [{ id: ID }, ChannelConnectionDetail];
  "channels.create": [ChannelConnectionCreate, ChannelConnection];
  "channels.update": [ChannelConnectionUpdate, ChannelConnection];
  "channels.setPaused": [{ id: ID; paused: boolean }, ChannelConnection];
  /** Stops syncing and forgets the feed link. Reservations and their history are kept. */
  "channels.remove": [{ id: ID }, null];
  /** Read feeds now (id null = every active connection). acceptShrink applies a feed that lost most of its bookings. */
  "channels.refresh": [{ id: ID | null; acceptShrink: boolean }, ChannelConnection[]];
  "channels.resolveEvent": [{ eventId: ID; action: ChannelEventAction }, ChannelConnectionDetail];
  "channels.pendingBlocks": [{ connectionId: ID | null }, PendingBlock[]];
  "channels.acknowledgeBlock": [{ connectionId: ID; start: IsoDate; end: IsoDate; done: boolean }, PendingBlock[]];

  "reservations.list": [ReservationFilter, ReservationSummary[]];
  "reservations.get": [{ id: ID }, ReservationDetail];
  "reservations.create": [ReservationCreate, ReservationDetail];
  "reservations.update": [ReservationUpdate, ReservationDetail];
  "reservations.cancel": [{ id: ID; reason: string }, ReservationDetail];

  "blocks.list": [{ from: IsoDate; to: IsoDate; propertyId: ID | null; includeCancelled: boolean }, AvailabilityBlock[]];
  "blocks.create": [AvailabilityBlockInput, AvailabilityBlock];
  "blocks.update": [AvailabilityBlockInput & { id: ID }, AvailabilityBlock];
  "blocks.cancel": [{ id: ID }, AvailabilityBlock];

  "turnovers.list": [TurnoverFilter, TurnoverItem[]];
  "turnovers.get": [{ id: ID }, TurnoverDetail];
  "turnovers.update": [TurnoverUpdate, TurnoverDetail];

  "stays.day": [{ date: IsoDate }, StayDay];
  "stays.calendar": [{ from: IsoDate; to: IsoDate; propertyId: ID | null }, StayCalendar];
  "stays.alerts": [void, StayAlert[]];
  "stays.performance": [{ from: YearMonth; to: YearMonth; groupBy: PerformanceGroup; propertyId: ID | null }, PerformanceReport];

  "ledger.list": [{ from: IsoDate; to: IsoDate; propertyId: ID | null; reservationId: ID | null }, LedgerEntry[]];
  "ledger.create": [LedgerInput, LedgerEntry];
  "ledger.void": [{ id: ID }, null];

  /** Opens a file dialog in main, parses the CSV and holds it until commit or discard. */
  "imports.pickAirbnbCsv": [void, CsvImportPreview | null];
  "imports.commit": [{ token: ID; listingMap: Record<string, ID | null> }, CsvImportResult];
  "imports.discard": [{ token: ID }, null];
}

export type ApiMethod = keyof ApiSpec;
export type ApiParams<M extends ApiMethod> = ApiSpec[M][0];
export type ApiResult<M extends ApiMethod> = ApiSpec[M][1];

/** Events pushed from main to the UI. */
export interface ApiEvents {
  "data-changed": { reason: "restore" | "workspace" | "cloud" | "channel-sync" };
  "cloud-progress": CloudProgress;
  /** Calendar feeds being read right now (empty when idle). */
  "channel-sync": { running: ID[] };
  "menu-command": { command: "new-property" | "new-maintenance" | "record-payment" | "backup" | "restore" | "search" | "settings" };
}

export type ApiEventName = keyof ApiEvents;

/** What the preload script exposes as `window.havenos`. */
export interface DesktopBridge {
  readonly bridgeVersion: 1;
  readonly platform: string;
  invoke(method: string, params: unknown): Promise<ApiResponse<unknown>>;
  on(event: string, listener: (payload: unknown) => void): () => void;
}
