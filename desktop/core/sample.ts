import { addDays, addMonths, monthOf } from "../../lib/domain/dates";
import type { PlannedSpace } from "../../lib/domain/onboarding";
import type { Core } from "./context";
import { addMaintenanceNote, createMaintenance } from "./services/maintenance";
import { createPropertyFromPlan, getProperty } from "./services/properties";
import { recordDeposit, recordPayment } from "./services/rent";
import { setSetting } from "./services/settings";
import { createTenancy, moveIn } from "./services/tenancies";

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
}
