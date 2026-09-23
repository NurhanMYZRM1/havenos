import type { OnboardingDraft, OnboardingDraftData } from "../../../lib/api/contract";
import { planFromDraft, sanitizeDraft } from "../../../lib/domain/onboarding";
import type { Core } from "../context";
import { notFound, validationError } from "../errors";
import { createPropertyFromPlan } from "./properties";
import { listAttachments, newId } from "./shared";

interface DraftRow {
  id: string;
  step: number;
  data: string;
  updated_at: string;
}

function toDraft(core: Core, row: DraftRow): OnboardingDraft {
  let data: OnboardingDraftData;
  try {
    data = sanitizeDraft(JSON.parse(row.data));
  } catch {
    data = sanitizeDraft({});
  }
  return {
    id: row.id,
    step: row.step,
    data,
    photos: listAttachments(core, { kind: "draft", id: row.id }),
    updatedAt: row.updated_at,
  };
}

/** The landlord's in-progress "Add a property" draft, if any (most recent). */
export function currentDraft(core: Core): OnboardingDraft | null {
  const row = core.db.get<DraftRow>(
    "SELECT id, step, data, updated_at FROM drafts WHERE kind = 'property_onboarding' ORDER BY updated_at DESC LIMIT 1",
  );
  return row ? toDraft(core, row) : null;
}

export function saveDraft(core: Core, params: { id: string | null; step: number; data: unknown }): OnboardingDraft {
  const data = sanitizeDraft(params.data);
  const step = Math.max(0, Math.min(4, Math.trunc(Number(params.step) || 0)));
  const now = core.nowIso();
  let id = params.id;
  if (id && core.db.get("SELECT 1 FROM drafts WHERE id = ?", [id])) {
    core.db.run("UPDATE drafts SET step = ?, data = ?, updated_at = ? WHERE id = ?", [step, JSON.stringify(data), now, id]);
  } else {
    id = newId();
    core.db.run("INSERT INTO drafts (id, kind, step, data, created_at, updated_at) VALUES (?, 'property_onboarding', ?, ?, ?, ?)", [
      id,
      step,
      JSON.stringify(data),
      now,
      now,
    ]);
  }
  return toDraft(core, core.db.get<DraftRow>("SELECT id, step, data, updated_at FROM drafts WHERE id = ?", [id])!);
}

export function discardDraft(core: Core, id: string) {
  core.db.run("DELETE FROM drafts WHERE id = ?", [id]);
}

/**
 * Turn a finished draft into a real property: property, units, rooms, beds,
 * and the draft's photos (in their chosen order), all in one transaction.
 */
export function completeDraft(core: Core, id: string): { propertyId: string } {
  const row = core.db.get<DraftRow>("SELECT id, step, data, updated_at FROM drafts WHERE id = ?", [id]);
  if (!row) throw notFound();
  const draft = toDraft(core, row);
  const plan = planFromDraft(draft.data);
  if (!plan.ok) throw validationError(plan.fields);
  return core.db.tx(() => {
    const propertyId = createPropertyFromPlan(core, plan.value);
    core.db.run("UPDATE attachments SET draft_id = NULL, property_id = ? WHERE draft_id = ?", [propertyId, id]);
    core.db.run("DELETE FROM drafts WHERE id = ?", [id]);
    return { propertyId };
  });
}
