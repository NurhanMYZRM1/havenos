/**
 * Every enumerated value the app stores. Display labels live in the i18n
 * catalog (lib/i18n) keyed by these values, never here, so a Bahasa Malaysia
 * catalog can be added without touching stored data.
 */

export const MY_STATES = [
  "JHR", "KDH", "KTN", "MLK", "NSN", "PHG", "PRK", "PLS", "PNG", "SBH", "SWK", "SGR", "TRG",
  "KUL", "LBN", "PJY",
] as const;
export type MyState = (typeof MY_STATES)[number];

export const PROPERTY_TYPES = [
  "condominium", "apartment", "terrace", "semi_d", "bungalow", "townhouse", "shophouse", "other",
] as const;
export type PropertyType = (typeof PROPERTY_TYPES)[number];

/** How a unit is let: to one household, room by room, or bed by bed. */
export const RENTAL_MODES = ["whole_unit", "by_room", "by_bed"] as const;
export type RentalMode = (typeof RENTAL_MODES)[number];

export const SPACE_KINDS = ["unit", "room", "bed"] as const;
export type SpaceKind = (typeof SPACE_KINDS)[number];

export const ROOM_TYPES = ["master", "medium", "small", "studio", "other"] as const;
export type RoomType = (typeof ROOM_TYPES)[number];

// Values match supabase/migrations/0001_core.sql so a future sync maps 1:1.
export const MAINTENANCE_STATUSES = ["triage", "scheduled", "in_progress", "blocked", "done", "cancelled"] as const;
export type MaintenanceStatus = (typeof MAINTENANCE_STATUSES)[number];
export const OPEN_MAINTENANCE_STATUSES: readonly MaintenanceStatus[] = ["triage", "scheduled", "in_progress", "blocked"];

export const MAINTENANCE_PRIORITIES = ["low", "standard", "high", "critical"] as const;
export type MaintenancePriority = (typeof MAINTENANCE_PRIORITIES)[number];

export const MAINTENANCE_CATEGORIES = [
  "plumbing", "electrical", "aircond", "appliance", "structural", "pest", "cleaning", "internet", "security", "general",
] as const;
export type MaintenanceCategory = (typeof MAINTENANCE_CATEGORIES)[number];

export const PAYMENT_METHODS = ["bank_transfer", "duitnow", "cash", "cheque", "card", "ewallet", "other"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const CHARGE_KINDS = ["rent", "utilities", "late_fee", "repair", "other"] as const;
export type ChargeKind = (typeof CHARGE_KINDS)[number];

export const DEPOSIT_TYPES = ["security", "utility", "other"] as const;
export type DepositType = (typeof DEPOSIT_TYPES)[number];

export const DEPOSIT_ENTRY_KINDS = ["received", "refunded", "deducted"] as const;
export type DepositEntryKind = (typeof DEPOSIT_ENTRY_KINDS)[number];

export const TENANCY_STATUSES = ["upcoming", "active", "expiring", "ended", "cancelled"] as const;
export type TenancyStatus = (typeof TENANCY_STATUSES)[number];

export const CHARGE_STATES = ["paid", "part_paid", "due", "overdue", "void"] as const;
export type ChargeState = (typeof CHARGE_STATES)[number];

export const ATTACHMENT_PURPOSES = ["photo", "document", "receipt"] as const;
export type AttachmentPurpose = (typeof ATTACHMENT_PURPOSES)[number];

/** Reservation channels for future short-stay support. Only "direct" is live. */
export const RESERVATION_CHANNELS = ["direct", "airbnb", "booking_com", "other"] as const;
export type ReservationChannel = (typeof RESERVATION_CHANNELS)[number];

export const EXPORT_DATASETS = [
  "properties", "spaces", "tenants", "tenancies", "charges", "payments", "deposits", "maintenance",
] as const;
export type ExportDataset = (typeof EXPORT_DATASETS)[number];

export function isOneOf<T extends string>(list: readonly T[], value: unknown): value is T {
  return typeof value === "string" && (list as readonly string[]).includes(value);
}
