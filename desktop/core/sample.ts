import { addDays, addMonths, monthOf } from "../../lib/domain/dates";
import type { PlannedSpace } from "../../lib/domain/onboarding";
import type { Core } from "./context";
import { addMaintenanceNote, createMaintenance } from "./services/maintenance";
import { createPropertyFromPlan, getProperty } from "./services/properties";
import { recordDeposit, recordPayment } from "./services/rent";
import { setSetting } from "./services/settings";
import { createTenancy, moveIn } from "./services/tenancies";
import { createBlock } from "./services/blocks";
import { cancelReservation, changeReservationDates, insertReservation, markReservationMissing, type ReservationWrite } from "./services/reservations";
import { newId } from "./services/shared";
import { getTurnover, updateTurnover } from "./services/turnovers";

/**
 * Fictional records for the separate sample workspace. Names, phone numbers
 * and addresses are invented; the sample never touches the landlord's real
 * database.
 */

const space = (kind: PlannedSpace["kind"], label: string, rent: number, children: PlannedSpace[] = [], extra: Partial<PlannedSpace> = {}): PlannedSpace => ({
  kind,
  label,
  rentalMode: null,
  floor: "",
  sizeSqft: null,
  bedrooms: null,
  roomType: null,
  defaultRentSen: rent,
  children,
  ...extra,
});

const tenant = (fullName: string, phone: string, email: string) => ({
  fullName,
  phone,
  email,
  emergencyName: "",
  emergencyPhone: "",
  notes: "",
});

export function seedSampleWorkspace(core: Core) {
  const today = core.today();
  const defaults = { rentDueDay: 7, securityDepositTenths: 20, utilityDepositTenths: 5, defaultTenancyMonths: 12, defaultTerms: "" };

  const condoId = createPropertyFromPlan(core, {
    property: {
      name: "Seri Mutiara Residences",
      propertyType: "condominium",
      addressLine1: "Jalan Contoh 3/2",
      addressLine2: "Block B",
      postcode: "47810",
      city: "Petaling Jaya",
      state: "SGR",
      notes: "Sample property — fictional address.",
      ...defaults,
    },
    units: [
      space("unit", "B-12-3", 0, [
        space("room", "Master bedroom", 90000, [], { roomType: "master" }),
        space("room", "Room 2", 65000, [], { roomType: "medium" }),
        space("room", "Room 3", 55000, [], { roomType: "small" }),
      ], { rentalMode: "by_room", floor: "12", sizeSqft: 1050, bedrooms: 3 }),
      space("unit", "B-15-8", 250000, [], { rentalMode: "whole_unit", floor: "15", sizeSqft: 900, bedrooms: 2 }),
    ],
  });

  const terraceId = createPropertyFromPlan(core, {
    property: {
      name: "Taman Contoh Terrace",
      propertyType: "terrace",
      addressLine1: "12 Jalan Sampel 5",
      addressLine2: "",
      postcode: "81300",
      city: "Skudai",
      state: "JHR",
      notes: "Sample property — student house let by the bed.",
      ...defaults,
      rentDueDay: 1,
    },
    units: [
      space("unit", "House", 0, [
        space("room", "Room A", 0, [space("bed", "Bed 1", 35000), space("bed", "Bed 2", 35000)], { roomType: "master" }),
        space("room", "Room B", 0, [space("bed", "Bed 1", 30000), space("bed", "Bed 2", 30000)], { roomType: "medium" }),
      ], { rentalMode: "by_bed", bedrooms: 4 }),
    ],
  });

  const condo = getProperty(core, condoId);
  const [roomUnit, wholeUnit] = condo.units;
  const terrace = getProperty(core, terraceId);
  const beds = terrace.units[0].children.flatMap((r) => r.children);

  const lastYear = addMonths(today, -10);
  const t1 = createTenancy(core, {
    tenantId: null,
    newTenant: tenant("Aisyah binti Rahman (sample)", "+60123456701", "aisyah@example.com"),
    spaceId: roomUnit.children[0].id,
    startDate: `${monthOf(lastYear)}-01`,
    endDate: addDays(addMonths(`${monthOf(lastYear)}-01`, 12), -1),
    monthlyRentSen: 90000,
    rentDueDay: 7,
    rentStartMonth: monthOf(addMonths(today, -2)),
    securityDepositSen: 180000,
    utilityDepositSen: 45000,
    terms: "",
    stagingKey: null,
  });
  moveIn(core, {
    id: t1.id,
    movedInOn: t1.startDate,
    notes: "Keys and access card handed over.",
    depositReceived: [
      { depositType: "security", amountSen: 180000, method: "bank_transfer", reference: "SAMPLE-DEP-1" },
      { depositType: "utility", amountSen: 45000, method: "bank_transfer", reference: "SAMPLE-DEP-1" },
    ],
  });
  recordPayment(core, { tenancyId: t1.id, receivedOn: addDays(today, -55), amountSen: 90000, method: "duitnow", reference: "SAMPLE-1001", description: "", notes: "", stagingKey: null });
  recordPayment(core, { tenancyId: t1.id, receivedOn: addDays(today, -25), amountSen: 90000, method: "duitnow", reference: "SAMPLE-1002", description: "", notes: "", stagingKey: null });

  const start2 = addMonths(today, -4);
  const t2 = createTenancy(core, {
    tenantId: null,
    newTenant: tenant("Daniel Wong (sample)", "+60167788990", "daniel@example.com"),
    spaceId: roomUnit.children[1].id,
    startDate: start2,
    endDate: addDays(addMonths(start2, 12), -1),
    monthlyRentSen: 65000,
    rentDueDay: 7,
    rentStartMonth: monthOf(addMonths(today, -1)),
    securityDepositSen: 130000,
    utilityDepositSen: 32500,
    terms: "",
    stagingKey: null,
  });
  moveIn(core, { id: t2.id, movedInOn: start2, notes: "", depositReceived: [{ depositType: "security", amountSen: 130000, method: "bank_transfer", reference: "" }] });
  // Part-paid: leaves an overdue balance to show how arrears look.
  recordPayment(core, { tenancyId: t2.id, receivedOn: addDays(today, -20), amountSen: 40000, method: "cash", reference: "", description: "", notes: "Paid part in cash", stagingKey: null });

  const t3 = createTenancy(core, {
    tenantId: null,
    newTenant: tenant("Priya Nair (sample)", "+60198765432", "priya@example.com"),
    spaceId: wholeUnit.id,
    startDate: addDays(addMonths(today, -12), 40),
    endDate: addDays(today, 39),
    monthlyRentSen: 250000,
    rentDueDay: 1,
    rentStartMonth: monthOf(today),
    securityDepositSen: 500000,
    utilityDepositSen: 125000,
    terms: "",
    stagingKey: null,
  });
  recordDeposit(core, { tenancyId: t3.id, depositType: "security", kind: "received", amountSen: 500000, occurredOn: t3.startDate, method: "bank_transfer", reference: "", notes: "" });
  recordPayment(core, { tenancyId: t3.id, receivedOn: `${monthOf(today)}-01`, amountSen: 250000, method: "bank_transfer", reference: "SAMPLE-2201", description: "", notes: "", stagingKey: null });

  createTenancy(core, {
    tenantId: null,
    newTenant: tenant("Muhammad Hafiz (sample)", "+60112345678", ""),
    spaceId: beds[0].id,
    startDate: addDays(today, 10),
    endDate: addDays(addMonths(addDays(today, 10), 6), -1),
    monthlyRentSen: 35000,
    rentDueDay: 1,
    rentStartMonth: monthOf(addDays(today, 10)),
    securityDepositSen: 35000,
    utilityDepositSen: 0,
    terms: "",
    stagingKey: null,
  });

  const m1 = createMaintenance(core, {
    propertyId: condoId,
    spaceId: roomUnit.id,
    tenantId: t1.tenantId,
    title: "Kitchen sink leaking (sample)",
    description: "Water pooling under the sink cabinet.",
    category: "plumbing",
    priority: "high",
    status: "scheduled",
    dueDate: addDays(today, -2),
    assigneeName: "Sample Plumbing Services",
    assigneePhone: "+60312345678",
    estimatedCostSen: 25000,
    actualCostSen: null,
    reportedOn: addDays(today, -6),
    stagingKey: null,
  });
  addMaintenanceNote(core, m1.id, "Plumber confirmed visit; tenant will be home.");
  createMaintenance(core, {
    propertyId: condoId,
    spaceId: wholeUnit.id,
    tenantId: null,
    title: "Aircond service before new tenancy (sample)",
    description: "",
    category: "aircond",
    priority: "standard",
    status: "triage",
    dueDate: addDays(today, 14),
    assigneeName: "",
    assigneePhone: "",
    estimatedCostSen: 18000,
    actualCostSen: null,
    reportedOn: today,
    stagingKey: null,
  });
  createMaintenance(core, {
    propertyId: terraceId,
    spaceId: null,
    tenantId: null,
    title: "Replace front gate padlock (sample)",
    description: "",
    category: "security",
    priority: "low",
    status: "done",
    dueDate: addDays(today, -20),
    assigneeName: "",
    assigneePhone: "",
    estimatedCostSen: 4000,
    actualCostSen: 3500,
    reportedOn: addDays(today, -25),
    stagingKey: null,
  });

  setSetting(core, "landlordName", "Sample Landlord");
  setSetting(core, "contactPhone", "+60123000000");

  seedShortStays(core);
}

/**
 * A short-stay slice: three whole units let on Airbnb, so the day view,
 * calendar, turnovers and alerts can be demoed offline. The sample
 * connections store no feed link, so they read as "feed link missing" and are
 * never synced.
 */
function seedShortStays(core: Core) {
  const today = core.today();
  const d = (n: number) => addDays(today, n);
  const now = core.nowIso();
  const hoursAgo = (h: number) => new Date(core.now().getTime() - h * 3_600_000).toISOString();

  const propertyId = createPropertyFromPlan(core, {
    property: {
      name: "Residensi Contoh Bukit Bintang",
      propertyType: "condominium",
      addressLine1: "88 Jalan Contoh Bintang",
      addressLine2: "Tower A",
      postcode: "55100",
      city: "Kuala Lumpur",
      state: "KUL",
      notes: "Sample property — fictional address. Run as Airbnb short stays.",
      rentDueDay: 1,
      securityDepositTenths: 20,
      utilityDepositTenths: 5,
      defaultTenancyMonths: 12,
      defaultTerms: "",
    },
    units: [
      space("unit", "Studio 21-05", 0, [], { rentalMode: "whole_unit", floor: "21", sizeSqft: 480, bedrooms: 1 }),
      space("unit", "Suite 21-06", 0, [], { rentalMode: "whole_unit", floor: "21", sizeSqft: 750, bedrooms: 2 }),
      space("unit", "Suite 22-01", 0, [], { rentalMode: "whole_unit", floor: "22", sizeSqft: 980, bedrooms: 3 }),
    ],
  });
  const [studio, suite, family] = getProperty(core, propertyId).units;

  const connection = (spaceId: string, name: string, opts: { status?: "active" | "paused"; checkIn: string; checkOut: string; listing: string; checklist?: string[] }) => {
    const id = newId();
    core.db.run(
      `INSERT INTO channel_connections (id, channel, method, name, external_listing_id, space_id, property_id, status, check_in_time, check_out_time,
         turnover_checklist, last_attempt_at, last_success_at, created_at, updated_at)
       VALUES (?, 'airbnb', 'ical', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, name, opts.listing, spaceId, propertyId, opts.status ?? "active", opts.checkIn, opts.checkOut, JSON.stringify(opts.checklist ?? []),
        hoursAgo(3), hoursAgo(3), now, now],
    );
    return id;
  };
  const cStudio = connection(studio.id, "Sample – Studio 21-05 (Airbnb)", {
    checkIn: "15:00",
    checkOut: "11:00",
    listing: "SAMPLE-2105",
    checklist: ["Change bed linen and towels", "Clean bathroom and restock toiletries", "Wipe kitchenette, empty fridge", "Vacuum and mop", "Take out rubbish", "Reset door code"],
  });
  const cSuite = connection(suite.id, "Sample – Suite 21-06 (Airbnb)", { checkIn: "16:00", checkOut: "12:00", listing: "SAMPLE-2106" });
  const cFamily = connection(family.id, "Sample – Suite 22-01 (Airbnb)", { status: "paused", checkIn: "15:00", checkOut: "11:00", listing: "SAMPLE-2201" });

  const stay = (input: Partial<ReservationWrite> & Pick<ReservationWrite, "spaceId" | "checkIn" | "checkOut">): string =>
    insertReservation(core, {
      guestName: "",
      guestCount: null,
      checkInTime: null,
      checkOutTime: null,
      status: "confirmed",
      channel: "airbnb",
      channelReservationId: null,
      connectionId: null,
      source: "feed",
      notes: "",
      lastSeenAt: now,
      ...input,
    });
  const feed = (connectionId: string, spaceId: string, code: string, checkIn: string, checkOut: string) =>
    stay({ spaceId, connectionId, channelReservationId: code, checkIn, checkOut });
  const direct = (spaceId: string, guestName: string, checkIn: string, checkOut: string, extra: Partial<ReservationWrite> = {}) =>
    stay({ spaceId, guestName, checkIn, checkOut, channel: "direct", source: "manual", lastSeenAt: null, ...extra });

  // Studio 21-05: a past stay, one leaving today (cleaned), one arriving today,
  // one the feed stopped listing, and a feed booking that clashes with a repair block.
  const past = feed(cStudio, studio.id, "HMSAMPLE01", d(-6), d(-2));
  const leaving = feed(cStudio, studio.id, "HMSAMPLE02", d(-2), d(0));
  feed(cStudio, studio.id, "HMSAMPLE03", d(0), d(3));
  const vanished = feed(cStudio, studio.id, "HMSAMPLE04", d(5), d(9));
  markReservationMissing(core, vanished);
  const aircond = createMaintenance(core, {
    propertyId,
    spaceId: studio.id,
    tenantId: null,
    title: "Replace aircond compressor (sample)",
    description: "Unit blows warm air. Technician needs the studio empty for two days.",
    category: "aircond",
    priority: "high",
    status: "scheduled",
    dueDate: d(10),
    assigneeName: "Sample Aircond Services",
    assigneePhone: "+60387654321",
    estimatedCostSen: 120000,
    actualCostSen: null,
    reportedOn: d(-3),
    stagingKey: null,
  });
  createBlock(core, { spaceId: studio.id, startDate: d(10), endDate: d(11), reason: "maintenance", maintenanceId: aircond.id, notes: "Aircond compressor replacement." });
  core.db.run(
    `INSERT INTO channel_events (id, connection_id, kind, external_uid, confirmation_code, start_date, end_date, summary, state, first_seen_at, last_seen_at)
     VALUES (?, ?, 'reservation', ?, 'HMSAMPLE05', ?, ?, 'Reserved', 'conflict', ?, ?)`,
    [newId(), cStudio, "sample-uid-hmsample05@airbnb.com", d(10), d(12), now, now],
  );
  core.db.run(
    `INSERT INTO channel_events (id, connection_id, kind, external_uid, confirmation_code, start_date, end_date, summary, state, first_seen_at, last_seen_at)
     VALUES (?, ?, 'block', ?, NULL, ?, ?, 'Airbnb (Not available)', 'applied', ?, ?)`,
    [newId(), cStudio, "sample-uid-block-1@airbnb.com", d(20), d(23), now, now],
  );
  const leavingTurnover = getTurnover(core, core.db.get<{ id: string }>("SELECT id FROM turnovers WHERE reservation_id = ?", [leaving])!.id);
  updateTurnover(core, {
    id: leavingTurnover.id,
    status: "done",
    assigneeName: "Kak Ros (sample cleaner)",
    assigneePhone: "+60129876543",
    checkoutTime: leavingTurnover.checkoutTime,
    checklist: leavingTurnover.checklist.map((i) => ({ ...i, done: true })),
    costSen: 8000,
    notes: "All good. Replaced one broken glass.",
  });

  // Suite 21-06: a guest leaving tomorrow (cleaner booked), a direct guest
  // arriving the same afternoon to a critical repair, a tentative and a
  // cancelled direct booking.
  const inHouse = feed(cSuite, suite.id, "HMSAMPLE11", d(-3), d(1));
  const arriving = direct(suite.id, "Lim Wei Jie (sample)", d(1), d(4), { guestCount: 2, checkInTime: "15:00", notes: "Arriving from KLIA around 2pm." });
  direct(suite.id, "Farah Aziz (sample)", d(14), d(16), { status: "tentative", guestCount: 3 });
  const cancelled = direct(suite.id, "Kenji Sato (sample)", d(7), d(9), { guestCount: 1 });
  cancelReservation(core, cancelled, "Guest changed travel plans.", "manual");
  const inHouseTurnover = getTurnover(core, core.db.get<{ id: string }>("SELECT id FROM turnovers WHERE reservation_id = ?", [inHouse])!.id);
  updateTurnover(core, {
    id: inHouseTurnover.id,
    status: "scheduled",
    assigneeName: "Sample Cleaning Co.",
    assigneePhone: "+60176655443",
    checkoutTime: inHouseTurnover.checkoutTime,
    checklist: inHouseTurnover.checklist,
    costSen: 12000,
    notes: "Tight turnaround: next guest checks in at 3pm.",
  });
  createMaintenance(core, {
    propertyId,
    spaceId: suite.id,
    tenantId: null,
    title: "Water heater not working (sample)",
    description: "Guest reported no hot water in the master bathroom.",
    category: "plumbing",
    priority: "critical",
    status: "triage",
    dueDate: d(1),
    assigneeName: "",
    assigneePhone: "",
    estimatedCostSen: 45000,
    actualCostSen: null,
    reportedOn: d(-1),
    stagingKey: null,
  });

  // Suite 22-01 (sync paused): a guest who left early, whose clean-up wasn't
  // marked done before the next guest checked in, and a family booked later.
  const early = feed(cFamily, family.id, "HMSAMPLE21", d(-6), d(0));
  changeReservationDates(core, early, { checkIn: d(-6), checkOut: d(-2) }, "feed");
  feed(cFamily, family.id, "HMSAMPLE22", d(-1), d(2));
  direct(family.id, "Tan family (sample)", d(20), d(25), { guestCount: 5, checkInTime: "16:00", checkOutTime: "10:00" });
  const earlyTurnover = getTurnover(core, core.db.get<{ id: string }>("SELECT id FROM turnovers WHERE reservation_id = ?", [early])!.id);
  updateTurnover(core, { ...earlyTurnover, status: "scheduled", assigneeName: "Kak Ros (sample cleaner)", assigneePhone: "+60129876543", notes: "" });

  // Money: an imported Airbnb export for the past stay, and entered figures.
  const importId = newId();
  core.db.run(
    `INSERT INTO stay_imports (id, kind, file_name, rows_total, rows_imported, rows_skipped, created_at)
     VALUES (?, 'airbnb_transactions', 'Sample Airbnb export', 4, 4, 0, ?)`,
    [importId, now],
  );
  const ledger = (row: { reservationId: string | null; spaceId: string; channel: string; kind: string; amountSen: number; occurredOn: string; source: "imported" | "entered"; ref?: string; category?: string; description: string }) =>
    core.db.run(
      `INSERT INTO stay_ledger (id, reservation_id, property_id, space_id, channel, kind, amount_sen, occurred_on, source, import_id, external_ref, category, description, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [newId(), row.reservationId, propertyId, row.spaceId, row.channel, row.kind, row.amountSen, row.occurredOn, row.source,
        row.source === "imported" ? importId : null, row.ref ?? null, row.category ?? "", row.description, now, now],
    );
  ledger({ reservationId: past, spaceId: studio.id, channel: "airbnb", kind: "booking_value", amountSen: 72000, occurredOn: d(-6), source: "imported", ref: "SAMPLE-HMSAMPLE01-booking", description: "4 nights" });
  ledger({ reservationId: past, spaceId: studio.id, channel: "airbnb", kind: "cleaning_fee", amountSen: 6000, occurredOn: d(-6), source: "imported", ref: "SAMPLE-HMSAMPLE01-cleaning", description: "Cleaning fee" });
  ledger({ reservationId: past, spaceId: studio.id, channel: "airbnb", kind: "channel_fee", amountSen: 2340, occurredOn: d(-6), source: "imported", ref: "SAMPLE-HMSAMPLE01-fee", description: "Airbnb host service fee" });
  ledger({ reservationId: past, spaceId: studio.id, channel: "airbnb", kind: "payout", amountSen: 75660, occurredOn: d(-5), source: "imported", ref: "SAMPLE-HMSAMPLE01-payout", description: "Payout" });
  ledger({ reservationId: leaving, spaceId: studio.id, channel: "airbnb", kind: "expense", amountSen: 8000, occurredOn: d(0), source: "entered", category: "cleaning", description: "Kak Ros — turnover clean" });
  ledger({ reservationId: arriving, spaceId: suite.id, channel: "direct", kind: "booking_value", amountSen: 54000, occurredOn: d(-10), source: "entered", description: "3 nights, paid by DuitNow" });
  ledger({ reservationId: null, spaceId: suite.id, channel: "direct", kind: "expense", amountSen: 4500, occurredOn: d(-4), source: "entered", category: "supplies", description: "Toiletries and coffee restock" });
}
