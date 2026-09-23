"use client";

import { useState, type DragEvent } from "react";
import { api, errorMessage, notifyChanged } from "@/lib/api/client";
import type { Attachment, AttachmentOwner, PropertySummary } from "@/lib/api/contract";
import type { AttachmentPurpose, PropertyType } from "@/lib/domain/enums";
import { formatBytes, formatDate } from "@/lib/domain/format";
import { plural, t } from "@/lib/i18n";
import { PropertyIllustration } from "./illustrations";
import { Button } from "./ui/button";
import { ConfirmDialog } from "./ui/dialog";
import { FormError } from "./ui/field";
import { Icon } from "./ui/icons";
import { useToast } from "./ui/toast";

const MAX_DROP_BYTES = 25 * 1024 * 1024;

function hasFiles(e: DragEvent) {
  return Array.from(e.dataTransfer.types).includes("Files");
}

/** Shared add-files logic: native picker (keyboard accessible) and drag-and-drop. */
function useFileImport(owner: AttachmentOwner, purpose: AttachmentPurpose) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const done = (added: Attachment[] | null) => {
    if (added && added.length) {
      notifyChanged();
      toast({
        tone: "success",
        message: purpose === "photo" ? plural(added.length, "photos.addedOne", "photos.addedMany") : plural(added.length, "common.fileAddedOne", "common.filesAdded"),
      });
    }
  };

  const pick = async () => {
    setError(null);
    setBusy(true);
    try {
      done(await api("attachments.pick", { owner, purpose }));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const drop = async (fileList: FileList) => {
    setError(null);
    const files = Array.from(fileList);
    const tooBig = files.find((f) => f.size > MAX_DROP_BYTES);
    if (tooBig) {
      setError(t("validation.fileTooLarge", { name: tooBig.name, max: 25 }));
      return;
    }
    setBusy(true);
    try {
      const payload = await Promise.all(files.map(async (f) => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) })));
      done(await api("attachments.importDropped", { owner, purpose, files: payload }));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return { pick, drop, busy, error, setError };
}

/**
 * Upload, choose a cover (first photo), reorder (drag or arrow buttons) and
 * remove photos. Files are copied into the app's own data folder.
 */
export function PhotoManager({ owner, photos, compact = false }: { owner: AttachmentOwner; photos: Attachment[]; compact?: boolean }) {
  const { pick, drop, busy, error, setError } = useFileImport(owner, "photo");
  const [dragOver, setDragOver] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [removing, setRemoving] = useState<Attachment | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);

  const reorder = async (ids: string[]) => {
    try {
      await api("attachments.reorder", { owner, orderedIds: ids });
      notifyChanged();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const move = (index: number, to: number) => {
    const ids = photos.map((p) => p.id);
    const [item] = ids.splice(index, 1);
    ids.splice(to, 0, item);
    void reorder(ids);
  };

  const onDropZone = (e: DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (hasFiles(e) && e.dataTransfer.files.length) void drop(e.dataTransfer.files);
  };

  return (
    <div className="space-y-4">
      <div
        onDragOver={(e) => {
          if (hasFiles(e)) {
            e.preventDefault();
            setDragOver(true);
          }
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDropZone}
        className={`flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-6 text-center transition-colors ${compact ? "py-6" : "py-9"} ${dragOver ? "border-brass bg-brass/10" : "border-[var(--hairline-strong)] bg-surface/60"}`}
      >
        <Icon name="camera" size={26} className="text-brass" />
        <div>
          <p className="text-[14px] font-medium">{dragOver ? t("photos.dropHere") : photos.length ? t("photos.addMore") : t("photos.add")}</p>
          <p className="mt-1 text-[12.5px] text-ink-3">{t("photos.dropHint")}</p>
        </div>
        <Button variant="primary" size="sm" onClick={() => void pick()} loading={busy} icon={<Icon name="upload" size={14} />}>
          {busy ? t("photos.uploading") : t("photos.add")}
        </Button>
        <p className="text-[12px] text-ink-3">{t("photos.heicHint")}</p>
      </div>
      <FormError message={error} />

      {photos.length > 0 && (
        <ol className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4" aria-label={t("photos.cover")}>
          {photos.map((photo, i) => (
            <li
              key={photo.id}
              draggable
              onDragStart={(e) => {
                setDragId(photo.id);
                e.dataTransfer.effectAllowed = "move";
              }}
              onDragOver={(e) => {
                if (dragId) e.preventDefault();
              }}
              onDrop={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (!dragId || dragId === photo.id) return;
                const from = photos.findIndex((p) => p.id === dragId);
                setDragId(null);
                move(from, i);
              }}
              onDragEnd={() => setDragId(null)}
              className={`card overflow-hidden ${dragId === photo.id ? "opacity-50" : ""}`}
            >
              <div className="relative aspect-[4/3] bg-surface-2">
                {/* eslint-disable-next-line @next/next/no-img-element -- local attachment protocol, not optimisable */}
                <img src={photo.thumbUrl} alt={photo.fileName} className="size-full object-cover" draggable={false} />
                {i === 0 && (
                  <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-bg/85 px-2 py-0.5 text-[11.5px] font-semibold text-brass-bright">
                    <Icon name="star" size={11} /> {t("photos.cover")}
                  </span>
                )}
              </div>
              <div className="flex items-center justify-between gap-1 px-2 py-1.5">
                <span className="sr-only">{t("photos.position", { n: i + 1, total: photos.length })}</span>
                <div className="flex gap-0.5">
                  <IconButton label={t("photos.moveEarlier")} icon="chevronLeft" disabled={i === 0} onClick={() => move(i, i - 1)} />
                  <IconButton label={t("photos.moveLater")} icon="chevronRight" disabled={i === photos.length - 1} onClick={() => move(i, i + 1)} />
                </div>
                <div className="flex gap-0.5">
                  {i > 0 && (
                    <button type="button" onClick={() => move(i, 0)} className="rounded-md px-2 py-1 text-[12px] font-medium text-ink-2 hover:bg-surface-2 hover:text-ink">
                      {t("photos.makeCover")}
                    </button>
                  )}
                  <IconButton label={`${t("photos.remove")}: ${photo.fileName}`} icon="trash" onClick={() => setRemoving(photo)} />
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}

      <ConfirmDialog
        open={!!removing}
        title={t("photos.remove")}
        body={t("photos.removeConfirm")}
        confirmLabel={t("common.remove")}
        danger
        pending={removeBusy}
        onClose={() => setRemoving(null)}
        onConfirm={async () => {
          if (!removing) return;
          setRemoveBusy(true);
          try {
            await api("attachments.remove", { id: removing.id });
            notifyChanged();
            setRemoving(null);
          } catch (err) {
            setError(errorMessage(err));
          } finally {
            setRemoveBusy(false);
          }
        }}
      />
    </div>
  );
}

export function IconButton({ label, icon, onClick, disabled }: { label: string; icon: Parameters<typeof Icon>[0]["name"]; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-label={label} title={label} className="grid size-8 place-items-center rounded-md text-ink-2 hover:bg-surface-2 hover:text-ink disabled:opacity-30">
      <Icon name={icon} size={15} />
    </button>
  );
}

/** Documents and receipts: open with the default app, save a copy, remove. */
export function AttachmentList({ owner, files, purpose = "document", help }: { owner: AttachmentOwner; files: Attachment[]; purpose?: AttachmentPurpose; help?: string }) {
  const { pick, drop, busy, error, setError } = useFileImport(owner, purpose);
  const toast = useToast();
  const [dragOver, setDragOver] = useState(false);
  const [removing, setRemoving] = useState<Attachment | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);

  const act = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <div
      className={`space-y-3 rounded-xl ${dragOver ? "outline outline-2 outline-brass" : ""}`}
      onDragOver={(e) => {
        if (hasFiles(e)) {
          e.preventDefault();
          setDragOver(true);
        }
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        if (e.dataTransfer.files.length) void drop(e.dataTransfer.files);
      }}
    >
      {help && <p className="text-[13px] text-ink-3">{help}</p>}
      {files.length > 0 && (
        <ul className="divide-y divide-[var(--hairline)] rounded-xl border border-[var(--hairline)]">
          {files.map((f) => (
            <li key={f.id} className="flex flex-wrap items-center gap-3 px-3.5 py-2.5">
              {f.isImage ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={f.thumbUrl} alt="" className="size-10 rounded-md object-cover" />
              ) : (
                <span className="grid size-10 place-items-center rounded-md bg-surface-2 text-ink-2">
                  <Icon name="file" />
                </span>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13.5px] font-medium">{f.fileName}</p>
                <p className="text-[12px] text-ink-3">
                  {formatBytes(f.sizeBytes)} · {formatDate(f.createdAt.slice(0, 10))}
                </p>
              </div>
              <div className="flex gap-1">
                <Button size="sm" variant="ghost" onClick={() => void act(() => api("attachments.open", { id: f.id }))}>
                  {t("common.open")}
                </Button>
                <IconButton
                  label={`${t("common.export")}: ${f.fileName}`}
                  icon="download"
                  onClick={() =>
                    void act(async () => {
                      const r = await api("attachments.saveAs", { id: f.id });
                      if (r) toast({ tone: "success", message: t("settings.exported", { path: r.path }) });
                    })
                  }
                />
                <IconButton label={`${t("common.remove")}: ${f.fileName}`} icon="trash" onClick={() => setRemoving(f)} />
              </div>
            </li>
          ))}
        </ul>
      )}
      <Button size="sm" onClick={() => void pick()} loading={busy} icon={<Icon name="upload" size={14} />}>
        {t("tenancies.actions.addDocument")}
      </Button>
      <FormError message={error} />
      <ConfirmDialog
        open={!!removing}
        title={t("common.remove")}
        body={removing?.fileName ?? ""}
        confirmLabel={t("common.remove")}
        danger
        pending={removeBusy}
        onClose={() => setRemoving(null)}
        onConfirm={async () => {
          if (!removing) return;
          setRemoveBusy(true);
          await act(() => api("attachments.remove", { id: removing.id }));
          notifyChanged();
          setRemoveBusy(false);
          setRemoving(null);
        }}
      />
    </div>
  );
}

/** Property cover: the first photo, or an illustration of the building type. */
export function PropertyCover({ cover, type, name, className = "" }: { cover: PropertySummary["cover"]; type: PropertyType; name: string; className?: string }) {
  if (cover) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={cover.thumbUrl} alt={name} className={`size-full object-cover ${className}`} />;
  }
  return <PropertyIllustration type={type} className={`size-full ${className}`} />;
}
