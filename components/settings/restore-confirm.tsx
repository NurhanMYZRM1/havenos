"use client";

import { useState } from "react";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Notice } from "@/components/ui/layout";
import { useToast } from "@/components/ui/toast";
import { api, errorMessage, notifyChanged } from "@/lib/api/client";
import type { BackupInspection } from "@/lib/api/contract";
import { formatBytes, formatTimestamp } from "@/lib/domain/format";
import { t } from "@/lib/i18n";

/** Shows what a checked backup contains and restores it on confirmation. */
export function RestoreConfirm({ inspection, onClose }: { inspection: BackupInspection | null; onClose: () => void }) {
  const toast = useToast();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const s = inspection?.summary;
  const close = () => {
    if (inspection) void api("backup.discardInspection", { token: inspection.token }).catch(() => undefined);
    setError(null);
    onClose();
  };
  return (
    <ConfirmDialog
      open={!!inspection}
      title={t("settings.restoreConfirmTitle")}
      body={
        s && (
          <>
            <p>{t("settings.restoreConfirmBody", { date: formatTimestamp(s.createdAt), version: s.appVersion })}</p>
            <p className="mt-2 text-ink">
              {t("settings.restoreCounts", {
                properties: s.counts.properties ?? 0,
                tenants: s.counts.tenants ?? 0,
                tenancies: s.counts.tenancies ?? 0,
                payments: s.counts.payments ?? 0,
                maintenance: s.counts.maintenance_requests ?? 0,
                attachments: s.attachmentCount,
              })}
            </p>
            <p className="mt-1 text-[12.5px] text-ink-3">
              {s.fileName} · {formatBytes(s.sizeBytes)}
            </p>
          </>
        )
      }
      confirmLabel={pending ? t("settings.restoring") : t("settings.restoreNow")}
      danger
      pending={pending}
      error={error}
      onClose={close}
      onConfirm={async () => {
        if (!inspection) return;
        setPending(true);
        setError(null);
        try {
          const result = await api("backup.restore", { token: inspection.token });
          notifyChanged();
          toast({ tone: "success", message: t("settings.restoreDone", { file: result.safetyBackupPath.split(/[\\/]/).pop() ?? "" }) });
          onClose();
        } catch (err) {
          setError(errorMessage(err));
        } finally {
          setPending(false);
        }
      }}
    >
      <Notice tone="warn">{t("settings.restoreWarning")}</Notice>
    </ConfirmDialog>
  );
}
