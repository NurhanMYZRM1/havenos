import fs from "node:fs";
import path from "node:path";
import type { ApiEvents, AppInfo, AttachmentOwner } from "../../lib/api/contract";
import { isYearMonth } from "../../lib/domain/dates";
import {
  ATTACHMENT_PURPOSES,
  EXPORT_DATASETS,
  isOneOf,
  MAINTENANCE_PRIORITIES,
  MAINTENANCE_STATUSES,
  TENANCY_STATUSES,
  type AttachmentPurpose,
} from "../../lib/domain/enums";
import {
  asObject,
  readDate,
  readId,
  validateChargeInput,
  validateChargeUpdate,
  validateDepositInput,
  validateMaintenanceInput,
  validateMoveIn,
  validateMoveOut,
  validatePaymentInput,
  validatePropertyInput,
  validateScheduleChange,
  validateSettingsInput,
  validateSpaceInput,
  validateSpaceUpdate,
  validateTenancyCreate,
  validateTenancyUpdate,
  validateTenantInput,
  type FieldErrors,
} from "../../lib/domain/validate";
import { backupFileName, BACKUP_EXTENSION } from "./backup/archive";
import type { CloudService } from "./cloud/service";
import { folderStats } from "./files";
import { AppError, validationError } from "./errors";
import { idParam, ok, text, type HandlerContext, type Handlers, type Platform } from "./handler-utils";
import { channelHandlers } from "./handlers-channels";
import { moneyHandlers } from "./handlers-money";
import { stayHandlers } from "./handlers-stays";
import type { ChannelSyncControl } from "./integrations/channels";
import { SCHEMA_VERSION } from "./schema";
import * as attachments from "./services/attachments";
import { dashboardSummary } from "./services/dashboard";
import * as drafts from "./services/drafts";
import { exportDataset } from "./services/export";
import * as maintenance from "./services/maintenance";
import * as properties from "./services/properties";
import * as rent from "./services/rent";
import { search } from "./services/search";
import { getSettings, updateSettings } from "./services/settings";
import { listAttachments } from "./services/shared";
import * as tenancies from "./services/tenancies";
import * as tenants from "./services/tenants";
import type { Workspaces } from "./workspace";

export type { Handlers, Platform };

function owner(params: unknown): AttachmentOwner {
  const o = asObject(asObject(params).owner);
  const kinds = ["property", "maintenance", "tenancy", "tenant", "payment", "draft", "turnover", "staging"] as const;
  if (!isOneOf(kinds, o.kind) || typeof o.id !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(o.id)) {
    throw new AppError("VALIDATION", "validation.chooseOne");
  }
  return { kind: o.kind, id: o.id };
}

function purpose(params: unknown): AttachmentPurpose {
  const p = asObject(params).purpose;
  if (!isOneOf(ATTACHMENT_PURPOSES, p)) throw new AppError("VALIDATION", "validation.chooseOne");
  return p;
}

/** Links the app may hand to the OS: contact links and our own website. */
export function isAllowedExternal(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol === "tel:" || u.protocol === "mailto:") return true;
    if (u.protocol !== "https:") return false;
    return ["wa.me", "havenos.co", "www.havenos.co"].includes(u.hostname);
  } catch {
    return false;
  }
}

export function createHandlers(ws: Workspaces, platform: Platform, cloud: CloudService, channels: ChannelSyncControl): Handlers {
  const core = () => ws.current;
  const ctx: HandlerContext = { ws, platform, channels, core };
  const changed = (reason: ApiEvents["data-changed"]["reason"]) => platform.emit("data-changed", { reason });

  const appInfo = (): AppInfo => {
    const c = core();
    const files = folderStats(c.attachmentsDir);
    let dbSize = 0;
    for (const f of [c.dbPath, `${c.dbPath}-wal`]) if (fs.existsSync(f)) dbSize += fs.statSync(f).size;
    return {
      appVersion: c.appVersion,
      platform: platform.name,
      isPackaged: platform.isPackaged,
      workspace: ws.workspace,
      dataDir: c.dir,
      dbPath: c.dbPath,
      schemaVersion: SCHEMA_VERSION,
      dbSizeBytes: dbSize,
      attachmentCount: files.count,
      attachmentBytes: files.bytes,
      today: c.today(),
    };
  };

  const handlers: Handlers = {
    "app.info": () => appInfo(),
    "app.openDataFolder": async () => {
      await platform.openPath(core().dir);
      return null;
    },
    "app.openExternal": async (p) => {
      const url = text(p, "url", 2000);
      if (!isAllowedExternal(url)) throw new AppError("NOT_ALLOWED", "errors.unexpected", { params: { message: "link not allowed" } });
      await platform.openExternal(url);
      return null;
    },
    "workspace.switch": (p) => {
      const o = asObject(p);
      if (o.workspace !== "main" && o.workspace !== "sample") throw new AppError("VALIDATION", "validation.chooseOne");
      ws.switchTo(o.workspace, { reset: o.reset === true });
      changed("workspace");
      return appInfo();
    },

    "settings.get": () => getSettings(core()),
    "settings.update": (p) => updateSettings(core(), ok(validateSettingsInput(p))),

    "properties.list": (p) => properties.listProperties(core(), { includeArchived: asObject(p).includeArchived === true }),
    "properties.get": (p) => properties.getProperty(core(), idParam(p)),
    "properties.update": (p) => properties.updateProperty(core(), idParam(p), ok(validatePropertyInput(p))),
    "properties.setArchived": (p) => properties.setPropertyArchived(core(), idParam(p), asObject(p).archived === true),
    "properties.delete": (p) => {
      properties.deleteProperty(core(), idParam(p));
      return null;
    },

    "spaces.create": (p) => properties.createSpace(core(), ok(validateSpaceInput(p))),
    "spaces.update": (p) => {
      const id = idParam(p);
      return properties.updateSpace(core(), ok(validateSpaceUpdate(p, properties.spaceKind(core(), id))));
    },
    "spaces.setArchived": (p) => properties.setSpaceArchived(core(), idParam(p), asObject(p).archived === true),
    "spaces.options": (p) => {
      const o = asObject(p);
      const f: FieldErrors = {};
      const params = {
        propertyId: readId(o, "propertyId", f, { required: false }),
        startDate: readDate(o, "startDate", f),
        endDate: readDate(o, "endDate", f),
        excludeTenancyId: readId(o, "excludeTenancyId", f, { required: false }),
      };
      if (Object.keys(f).length) throw validationError(f);
      return properties.spaceOptions(core(), params);
    },

    "drafts.current": () => drafts.currentDraft(core()),
    "drafts.save": (p) => {
      const o = asObject(p);
      const id = o.id == null ? null : idParam(p);
      return drafts.saveDraft(core(), { id, step: Number(o.step) || 0, data: o.data });
    },
    "drafts.discard": (p) => {
      drafts.discardDraft(core(), idParam(p));
      return null;
    },
    "drafts.complete": (p) => drafts.completeDraft(core(), idParam(p)),

    "tenants.list": (p) => tenants.listTenants(core(), text(p, "query", 100)),
    "tenants.get": (p) => tenants.getTenant(core(), idParam(p)),
    "tenants.create": (p) => tenants.createTenant(core(), ok(validateTenantInput(p))),
    "tenants.update": (p) => tenants.updateTenant(core(), idParam(p), ok(validateTenantInput(p))),

    "tenancies.list": (p) => {
      const o = asObject(p);
      const filter = o.filter === "current" || o.filter === "all" || isOneOf(TENANCY_STATUSES, o.filter) ? o.filter : "current";
      const f: FieldErrors = {};
      return tenancies.listTenancies(core(), {
        filter,
        propertyId: readId(o, "propertyId", f, { required: false }),
        tenantId: readId(o, "tenantId", f, { required: false }),
      });
    },
    "tenancies.get": (p) => tenancies.getTenancy(core(), idParam(p)),
    "tenancies.create": (p) => tenancies.createTenancy(core(), ok(validateTenancyCreate(p))),
    "tenancies.update": (p) => tenancies.updateTenancy(core(), ok(validateTenancyUpdate(p))),
    "tenancies.moveIn": (p) => tenancies.moveIn(core(), ok(validateMoveIn(p))),
    "tenancies.moveOut": (p) => tenancies.moveOut(core(), ok(validateMoveOut(p))),
    "tenancies.cancel": (p) => tenancies.cancelTenancy(core(), idParam(p), text(p, "reason")),
    "tenancies.delete": (p) => {
      tenancies.deleteTenancy(core(), idParam(p));
      return null;
    },

    "rent.month": (p) => {
      const month = asObject(p).month;
      if (!isYearMonth(month)) throw new AppError("VALIDATION", "validation.invalidMonth");
      return rent.rentMonth(core(), month);
    },
    "rent.setSchedule": (p) => {
      const input = ok(validateScheduleChange(p));
      rent.setSchedule(core(), input);
      return tenancies.getTenancy(core(), input.tenancyId);
    },
    "rent.addCharge": (p) => tenancies.getTenancy(core(), rent.addCharge(core(), ok(validateChargeInput(p)))),
    "rent.updateCharge": (p) => tenancies.getTenancy(core(), rent.updateCharge(core(), ok(validateChargeUpdate(p)))),
    "rent.voidCharge": (p) => tenancies.getTenancy(core(), rent.voidCharge(core(), idParam(p), text(p, "reason"))),
    "rent.recordPayment": (p) => rent.recordPayment(core(), ok(validatePaymentInput(p))),
    "rent.voidPayment": (p) => tenancies.getTenancy(core(), rent.voidPayment(core(), idParam(p), text(p, "reason"))),
    "rent.receipt": (p) => rent.receipt(core(), idParam(p, "paymentId")),
    "rent.saveReceiptPdf": async (p) => {
      const id = idParam(p, "paymentId");
      const r = rent.receipt(core(), id);
      const target = await platform.saveFile(`Receipt-${r.payment.receiptNo}.pdf`, { name: "PDF", extensions: ["pdf"] });
      if (!target) return null;
      fs.writeFileSync(target, await platform.receiptPdf(id));
      return { path: target };
    },
    "deposits.record": (p) => tenancies.getTenancy(core(), rent.recordDeposit(core(), ok(validateDepositInput(p)))),
    "deposits.void": (p) => tenancies.getTenancy(core(), rent.voidDeposit(core(), idParam(p))),

    "maintenance.list": (p) => {
      const o = asObject(p);
      const f: FieldErrors = {};
      const status = o.status === "open" || o.status === "all" || isOneOf(MAINTENANCE_STATUSES, o.status) ? o.status : "open";
      return maintenance.listMaintenance(core(), {
        propertyId: readId(o, "propertyId", f, { required: false }),
        status,
        priority: isOneOf(MAINTENANCE_PRIORITIES, o.priority) ? o.priority : null,
        overdueOnly: o.overdueOnly === true,
        query: text(p, "query", 100),
      });
    },
    "maintenance.get": (p) => maintenance.getMaintenance(core(), idParam(p)),
    "maintenance.create": (p) => {
      const input = ok(validateMaintenanceInput(p));
      const f: FieldErrors = {};
      const stagingKey = readId(asObject(p), "stagingKey", f, { required: false });
      return maintenance.createMaintenance(core(), { ...input, stagingKey });
    },
    "maintenance.update": (p) => maintenance.updateMaintenance(core(), idParam(p), ok(validateMaintenanceInput(p))),
    "maintenance.addNote": (p) => maintenance.addMaintenanceNote(core(), idParam(p), text(p, "note", 5000)),

    "attachments.pick": async (p) => {
      const o = owner(p);
      const pur = purpose(p);
      const paths = await platform.pickFiles(pur);
      if (!paths || paths.length === 0) return null;
      return attachments.importFromPaths(core(), o, pur, paths);
    },
    "attachments.importDropped": (p) => {
      const o = owner(p);
      const pur = purpose(p);
      const files = asObject(p).files;
      if (!Array.isArray(files) || files.length === 0) throw new AppError("VALIDATION", "validation.required");
      const parsed = files.map((raw) => {
        const f = asObject(raw);
        if (typeof f.name !== "string" || !(f.bytes instanceof Uint8Array)) throw new AppError("VALIDATION", "validation.required");
        return { name: f.name, bytes: Buffer.from(f.bytes.buffer, f.bytes.byteOffset, f.bytes.byteLength) };
      });
      return attachments.importFiles(core(), o, pur, parsed);
    },
    "attachments.list": (p) => listAttachments(core(), owner(p)),
    "attachments.reorder": (p) => {
      const ids = asObject(p).orderedIds;
      if (!Array.isArray(ids) || !ids.every((i) => typeof i === "string")) throw new AppError("VALIDATION", "validation.required");
      return attachments.reorderAttachments(core(), owner(p), ids as string[]);
    },
    "attachments.remove": (p) => {
      attachments.removeAttachment(core(), idParam(p));
      return null;
    },
    "attachments.open": async (p) => {
      await platform.openPath(attachments.attachmentForExport(core(), idParam(p)).path);
      return null;
    },
    "attachments.saveAs": async (p) => {
      const file = attachments.attachmentForExport(core(), idParam(p));
      const ext = path.extname(file.fileName).slice(1) || "bin";
      const target = await platform.saveFile(file.fileName, { name: ext.toUpperCase(), extensions: [ext] });
      if (!target) return null;
      fs.copyFileSync(file.path, target);
      return { path: target };
    },

    "dashboard.summary": (p) => {
      const month = asObject(p).month;
      if (!isYearMonth(month)) throw new AppError("VALIDATION", "validation.invalidMonth");
      return dashboardSummary(core(), month);
    },
    "search.query": (p) => search(core(), text(p, "query", 100)),

    "export.dataset": async (p) => {
      const dataset = asObject(p).dataset;
      if (!isOneOf(EXPORT_DATASETS, dataset)) throw new AppError("VALIDATION", "validation.chooseOne");
      const out = exportDataset(core(), dataset);
      const target = await platform.saveFile(out.fileName, { name: "CSV", extensions: ["csv"] });
      if (!target) return null;
      fs.writeFileSync(target, out.content, "utf8");
      return { path: target };
    },
    "export.all": async () => {
      const folder = await platform.pickFolder();
      if (!folder) return null;
      const dir = path.join(folder, `HavenOS-export-${core().today()}`);
      fs.mkdirSync(dir, { recursive: true });
      for (const dataset of EXPORT_DATASETS) {
        const out = exportDataset(core(), dataset);
        fs.writeFileSync(path.join(dir, out.fileName), out.content, "utf8");
      }
      platform.showInFolder(dir);
      return { folder: dir, files: EXPORT_DATASETS.length };
    },

    "backup.create": async () => {
      if (ws.workspace !== "main") throw new AppError("NOT_ALLOWED", "errors.sampleNoBackup");
      const target = await platform.saveFile(backupFileName(core().now()), { name: "HavenOS backup", extensions: [BACKUP_EXTENSION] });
      if (!target) return null;
      const summary = await ws.backupTo(target);
      return { path: target, summary };
    },
    "backup.pickAndInspect": async () => {
      const file = await platform.pickBackup();
      if (!file) return null;
      return ws.inspect(file);
    },
    "backup.inspectSafety": (p) => {
      const file = text(p, "path", 4000);
      const known = ws.listSafetyBackups().find((b) => b.path === file);
      if (!known) throw new AppError("NOT_FOUND", "errors.notFound");
      return ws.inspect(known.path);
    },
    "backup.restore": async (p) => {
      const token = text(p, "token", 200);
      const result = await ws.restore(token);
      changed("restore");
      return result;
    },
    "backup.discardInspection": (p) => {
      ws.discardInspection(text(p, "token", 200));
      return null;
    },
    "backup.listSafety": () => ws.listSafetyBackups(),

    "cloud.status": (p) => cloud.status(asObject(p).refresh === true),
    "cloud.requestCode": (p) => cloud.requestCode(text(p, "email", 200)),
    "cloud.verifyCode": (p) => cloud.verifyCode(text(p, "email", 200), text(p, "code", 20)),
    "cloud.signOut": () => cloud.signOut(),
    "cloud.setOptIn": (p) => {
      const o = asObject(p);
      return cloud.setOptIn(o.optedIn === true, o.consent === true);
    },
    "cloud.backupNow": () => cloud.backupNow(),
    "cloud.list": () => cloud.list(),
    "cloud.restore": (p) => cloud.restore(idParam(p)),
    "cloud.openCheckout": async (p) => {
      const plan = asObject(p).plan;
      if (plan !== "monthly" && plan !== "annual") throw new AppError("VALIDATION", "validation.chooseOne");
      await cloud.openCheckout(plan);
      return null;
    },
    "cloud.openBillingPortal": async () => {
      await cloud.openBillingPortal();
      return null;
    },

    ...channelHandlers(ctx),
    ...stayHandlers(ctx),
    ...moneyHandlers(ctx),
  };

  return handlers;
}
