import fs from "node:fs";
import type { Attachment, AttachmentOwner } from "../../../lib/api/contract";
import type { AttachmentPurpose } from "../../../lib/domain/enums";
import type { Core } from "../context";
import { AppError, notFound } from "../errors";
import { attachmentPath, storeFile, sweepAttachments, type StoredFile } from "../files";
import { addMaintenanceEvent } from "./maintenance";
import { ATTACHMENT_COLUMNS, listAttachments, newId, OWNER_COLUMN, toAttachment, type AttachmentRow } from "./shared";

const OWNER_TABLE: Record<Exclude<AttachmentOwner["kind"], "staging">, string> = {
  property: "properties",
  maintenance: "maintenance_requests",
  tenancy: "tenancies",
  tenant: "tenants",
  payment: "payments",
  draft: "drafts",
};

export const MAX_FILES_PER_IMPORT = 30;

function assertOwner(core: Core, owner: AttachmentOwner) {
  if (owner.kind === "staging") {
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(owner.id)) throw notFound();
    return;
  }
  const table = OWNER_TABLE[owner.kind];
  if (!table || !core.db.get(`SELECT 1 FROM ${table} WHERE id = ?`, [owner.id])) throw notFound();
}

/** Import files (from a native dialog path or dropped bytes) for one owner. */
export function importFiles(
  core: Core,
  owner: AttachmentOwner,
  purpose: AttachmentPurpose,
  files: { name: string; bytes: Buffer }[],
): Attachment[] {
  assertOwner(core, owner);
  if (files.length > MAX_FILES_PER_IMPORT) throw new AppError("VALIDATION", "validation.tooLong");
  // Validate and store every file before touching the database; a bad file
  // anywhere in the batch rejects the whole batch and removes what was copied.
  const stored: StoredFile[] = [];
  const discard = () => {
    for (const s of stored) {
      fs.rmSync(attachmentPath(core, s.storedName), { force: true });
      if (s.thumbName) fs.rmSync(attachmentPath(core, s.thumbName), { force: true });
    }
  };
  try {
    for (const f of files) stored.push(storeFile(core, { name: f.name, bytes: f.bytes, purpose }));
  } catch (err) {
    discard();
    throw err;
  }
  const col = OWNER_COLUMN[owner.kind];
  const ids: string[] = [];
  try {
    core.db.tx(() => {
      let order = core.db.get<{ n: number }>(`SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM attachments WHERE ${col} = ?`, [owner.id])?.n ?? 0;
      for (const s of stored) {
        const id = newId();
        ids.push(id);
        core.db.run(
          `INSERT INTO attachments (id, ${col}, purpose, file_name, stored_name, thumb_name, mime_type, size_bytes, sha256, width, height,
             sort_order, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [id, owner.id, purpose, s.fileName, s.storedName, s.thumbName, s.mimeType, s.sizeBytes, s.sha256, s.width, s.height, order++, core.nowIso()],
        );
      }
      if (owner.kind === "maintenance") {
        addMaintenanceEvent(core, owner.id, "attachment_added", [], stored.map((s) => s.fileName).join(", "));
      }
    });
  } catch (err) {
    discard();
    throw err;
  }
  return listAttachments(core, owner).filter((a) => ids.includes(a.id));
}

export function importFromPaths(core: Core, owner: AttachmentOwner, purpose: AttachmentPurpose, paths: string[]): Attachment[] {
  const files = paths.map((p) => {
    const stat = fs.statSync(p);
    if (!stat.isFile()) throw new AppError("VALIDATION", "validation.fileType", { params: { name: p } });
    if (stat.size > 25 * 1024 * 1024) {
      throw new AppError("VALIDATION", "validation.fileTooLarge", { params: { name: p.split(/[\\/]/).pop() ?? p, max: 25 } });
    }
    return { name: p.split(/[\\/]/).pop() ?? "file", bytes: fs.readFileSync(p) };
  });
  return importFiles(core, owner, purpose, files);
}

export function getAttachmentRow(core: Core, id: string): AttachmentRow & { stored_name: string; maintenance_id: string | null } {
  const row = core.db.get<AttachmentRow & { stored_name: string; maintenance_id: string | null }>(
    `SELECT ${ATTACHMENT_COLUMNS}, stored_name, maintenance_id FROM attachments WHERE id = ?`,
    [id],
  );
  if (!row) throw notFound();
  return row;
}

/** Absolute path of an attachment (or its thumbnail) for the file protocol. */
export function resolveAttachmentFile(core: Core, id: string, thumb: boolean): { path: string; mime: string } | null {
  const row = core.db.get<{ stored_name: string; thumb_name: string | null; mime_type: string }>(
    "SELECT stored_name, thumb_name, mime_type FROM attachments WHERE id = ?",
    [id],
  );
  if (!row) return null;
  if (thumb && row.thumb_name) return { path: attachmentPath(core, row.thumb_name), mime: "image/jpeg" };
  return { path: attachmentPath(core, row.stored_name), mime: row.mime_type };
}

export function reorderAttachments(core: Core, owner: AttachmentOwner, orderedIds: string[]): Attachment[] {
  assertOwner(core, owner);
  const col = OWNER_COLUMN[owner.kind];
  const existing = core.db.all<{ id: string }>(`SELECT id FROM attachments WHERE ${col} = ?`, [owner.id]).map((r) => r.id);
  const valid = orderedIds.filter((id) => existing.includes(id));
  const rest = existing.filter((id) => !valid.includes(id));
  core.db.tx(() => {
    [...valid, ...rest].forEach((id, i) => core.db.run("UPDATE attachments SET sort_order = ? WHERE id = ?", [i, id]));
  });
  return listAttachments(core, owner);
}

export function removeAttachment(core: Core, id: string) {
  const row = getAttachmentRow(core, id);
  core.db.tx(() => {
    core.db.run("DELETE FROM attachments WHERE id = ?", [id]);
    if (row.maintenance_id) addMaintenanceEvent(core, row.maintenance_id, "attachment_removed", [], row.file_name);
  });
  sweepAttachments(core, { minFileAgeMs: 0 });
}

export function attachmentForExport(core: Core, id: string): { path: string; fileName: string } {
  const row = getAttachmentRow(core, id);
  return { path: attachmentPath(core, row.stored_name), fileName: row.file_name };
}

export function toAttachmentById(core: Core, id: string): Attachment {
  return toAttachment(getAttachmentRow(core, id));
}
