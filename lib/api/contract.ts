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
  ChargeKind,
  ChargeState,
  DepositEntryKind,
  DepositType,
  ExportDataset,
  MaintenanceCategory,
  MaintenancePriority,
  MaintenanceStatus,
  MyState,
  PaymentMethod,
  PropertyType,
  RentalMode,
  RoomType,
  SpaceKind,
  TenancyStatus,
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

export type AttachmentOwnerKind = "property" | "maintenance" | "tenancy" | "tenant" | "payment" | "draft" | "staging";

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
}

export type ApiMethod = keyof ApiSpec;
export type ApiParams<M extends ApiMethod> = ApiSpec[M][0];
export type ApiResult<M extends ApiMethod> = ApiSpec[M][1];

/** Events pushed from main to the UI. */
export interface ApiEvents {
  "data-changed": { reason: "restore" | "workspace" | "cloud" };
  "cloud-progress": CloudProgress;
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
