"use client";

import { useEffect, useState } from "react";
import { RestoreConfirm } from "@/components/settings/restore-confirm";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, FormError, TextInput } from "@/components/ui/field";
import { Icon } from "@/components/ui/icons";
import { Card, Loading, Notice } from "@/components/ui/layout";
import { api, errorMessage, onEvent } from "@/lib/api/client";
import type { BackupInspection, CloudBackupItem, CloudProgress, CloudStatus } from "@/lib/api/contract";
import { formatBytes, formatDate, formatTimestamp } from "@/lib/domain/format";
import { t, type MessageKey } from "@/lib/i18n";
import { CLOUD_BACKUPS_KEPT } from "@/supabase/functions/_shared/protocol";

function ProgressBar({ p }: { p: CloudProgress }) {
  const pct = p.bytesTotal > 0 ? Math.min(100, Math.round((p.bytesDone / p.bytesTotal) * 100)) : null;
  return (
    <div className="space-y-1.5" role="status" aria-live="polite">
      <div className="flex justify-between text-[13px]">
        <span>{t(`cloud.phases.${p.phase}` as MessageKey)}</span>
        {pct !== null && p.phase !== "error" && <span className="tnum text-ink-3">{pct}% · {formatBytes(p.bytesDone)} / {formatBytes(p.bytesTotal)}</span>}
      </div>
      {p.phase !== "error" && (
        <div className="h-1.5 overflow-hidden rounded-full bg-[var(--hairline-strong)]" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct ?? undefined}>
          <div className={`h-full rounded-full ${p.phase === "done" ? "bg-good" : "bg-gold"} ${pct === null ? "w-1/3 animate-pulse" : ""}`} style={pct !== null ? { width: `${pct}%` } : undefined} />
        </div>
      )}
      {p.error && <p className="text-[13px] text-[#ff9d95]">{p.error}</p>}
    </div>
  );
}

function Plan({ status }: { status: CloudStatus }) {
  const e = status.entitlement;
  if (status.entitlementError && !e) return <p className="text-[13.5px] text-[#ff9d95]">{t("cloud.planUnknown", { error: status.entitlementError })}</p>;
  if (!e) return <p className="text-[13.5px] text-ink-3">{t("common.loading")}</p>;
  const until = e.currentPeriodEnd ? formatDate(e.currentPeriodEnd.slice(0, 10)) : "";
  const text =
    e.status === "active"
      ? t("cloud.planActive", { until: until ? t("cloud.planUntil", { date: until }) : "" })
      : e.status === "grace"
        ? t("cloud.planGrace", { date: until })
        : e.status === "expired"
          ? t("cloud.planExpired")
          : t("cloud.planNone");
  return <p className={`text-[14px] ${e.status === "active" ? "text-good" : e.status === "none" ? "text-ink-2" : "text-warn"}`}>{text}</p>;
}

/**
 * Optional paid cloud backup. Every state shown here comes from the
 * desktop process or the server — nothing is assumed or simulated.
 */
export function CloudPanel() {
  const [status, setStatus] = useState<CloudStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [consent, setConsent] = useState(false);
  const [progress, setProgress] = useState<CloudProgress | null>(null);
  const [backups, setBackups] = useState<CloudBackupItem[] | null>(null);
  const [inspection, setInspection] = useState<BackupInspection | null>(null);

  const run = async <T,>(label: string, fn: () => Promise<T>): Promise<T | undefined> => {
    setBusy(label);
    setError(null);
    try {
      return await fn();
    } catch (err) {
      setError(errorMessage(err));
      return undefined;
    } finally {
      setBusy(null);
    }
  };

  useEffect(() => {
    void run("load", async () => setStatus(await api("cloud.status", { refresh: true })));
    return onEvent("cloud-progress", (p) => {
      setProgress(p);
      if (p.phase === "done" || p.phase === "error") void api("cloud.status", { refresh: false }).then(setStatus);
    });
  }, []);

  if (!status) return busy ? <Loading /> : <FormError message={error} />;

  const included = (
    <Card title={t("cloud.included")}>
      <ul className="space-y-2.5 text-[13.5px] leading-relaxed">
        <li className="flex gap-2.5"><Icon name="hardDrive" className="mt-0.5 text-good" />{t("cloud.includedFree")}</li>
        <li className="flex gap-2.5"><Icon name="cloud" className="mt-0.5 text-brass-bright" />{t("cloud.includedPaid", { n: CLOUD_BACKUPS_KEPT })}</li>
        <li className="flex gap-2.5"><Icon name="info" className="mt-0.5 text-ink-3" />{t("cloud.notIncluded")}</li>
        <li className="flex gap-2.5"><Icon name="check" className="mt-0.5 text-good" />{t("cloud.lapse")}</li>
      </ul>
    </Card>
  );

  if (!status.configured) {
    return (
      <div className="space-y-4">
        <Notice tone="info">
          <strong className="font-semibold">{t("cloud.notConfigured")}</strong> {t("cloud.notConfiguredHelp")}
        </Notice>
        {included}
      </div>
    );
  }

  const running = progress && !["done", "error"].includes(progress.phase);

  return (
    <div className="space-y-4">
      {status.credentialStorage === "unavailable" && <Notice tone="warn">{t("cloud.credentialsUnavailable")}</Notice>}
      <FormError message={error} />

      {!status.signedIn ? (
        <Card title={t("cloud.signIn")}>
          <p className="mb-4 text-[13.5px] text-ink-2">{t("cloud.signInHelp")}</p>
          <form
            noValidate
            className="flex flex-wrap items-end gap-3"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!codeSent) {
                const s = await run("code", () => api("cloud.requestCode", { email }));
                if (s) {
                  setStatus(s);
                  setCodeSent(true);
                }
              } else {
                const s = await run("verify", () => api("cloud.verifyCode", { email, code }));
                if (s) setStatus(s);
              }
            }}
          >
            <Field label={t("cloud.email")} className="min-w-[260px] flex-1">
              <TextInput type="email" value={email} onChange={(e) => setEmail(e.target.value)} disabled={codeSent} autoComplete="email" />
            </Field>
            {codeSent && (
              <Field label={t("cloud.code")} hint={t("cloud.codeSent", { email })} className="w-48">
                <TextInput value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" />
              </Field>
            )}
            <Button type="submit" variant="primary" loading={busy === "code" || busy === "verify"}>
              {codeSent ? t("cloud.verify") : t("cloud.sendCode")}
            </Button>
          </form>
        </Card>
      ) : (
        <>
          <Card
            title={t("cloud.plan")}
            actions={
              <>
                <span className="text-[13px] text-ink-3">{t("cloud.signedInAs", { email: status.email ?? "" })}</span>
                <Button size="sm" variant="ghost" loading={busy === "signout"} onClick={async () => { const s = await run("signout", () => api("cloud.signOut")); if (s) setStatus(s); }}>
                  {t("cloud.signOut")}
                </Button>
              </>
            }
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Plan status={status} />
              <Button size="sm" loading={busy === "refresh"} onClick={async () => { const s = await run("refresh", () => api("cloud.status", { refresh: true })); if (s) setStatus(s); }}>
                {t("cloud.refresh")}
              </Button>
            </div>
            <div className="mt-4 flex flex-wrap gap-2.5">
              {status.entitlement?.status !== "active" && (
                <>
                  <Button variant="primary" loading={busy === "monthly"} onClick={() => void run("monthly", () => api("cloud.openCheckout", { plan: "monthly" }))}>
                    {t("cloud.subscribeMonthly")}
                  </Button>
                  <Button loading={busy === "annual"} onClick={() => void run("annual", () => api("cloud.openCheckout", { plan: "annual" }))}>
                    {t("cloud.subscribeAnnual")}
                  </Button>
                </>
              )}
              {status.entitlement && status.entitlement.status !== "none" && (
                <Button variant="ghost" loading={busy === "portal"} onClick={() => void run("portal", () => api("cloud.openBillingPortal"))}>
                  {t("cloud.manageBilling")}
                </Button>
              )}
            </div>
            <p className="mt-3 text-[12.5px] text-ink-3">{t("cloud.subscribeHelp")}</p>
          </Card>

          <Card title={t("cloud.consentTitle")}>
            {status.optedIn ? (
              <div className="space-y-4">
                <p className="text-[13.5px] text-good">{t("cloud.optedInSince", { date: formatTimestamp(status.optedInAt) })}</p>
                <div className="flex flex-wrap gap-2.5">
                  <Button variant="primary" disabled={!!running} loading={busy === "backup"} onClick={async () => { const s = await run("backup", () => api("cloud.backupNow")); if (s) setStatus(s); }} icon={<Icon name="upload" size={15} />}>
                    {t("cloud.backupNow")}
                  </Button>
                  <Button variant="ghost" onClick={async () => { const s = await run("optout", () => api("cloud.setOptIn", { optedIn: false, consent: false })); if (s) setStatus(s); }}>
                    {t("cloud.optOut")}
                  </Button>
                </div>
                {progress && progress.operation === "backup" && <ProgressBar p={progress} />}
                <p className="text-[13px] text-ink-2">{status.lastSuccessAt ? t("cloud.lastSuccess", { when: formatTimestamp(status.lastSuccessAt) }) : t("cloud.neverSucceeded")}</p>
                {status.lastAttempt && !status.lastAttempt.ok && <p className="text-[13px] text-[#ff9d95]">{t("cloud.lastFailed", { when: formatTimestamp(status.lastAttempt.at), error: status.lastAttempt.error ?? "" })}</p>}
              </div>
            ) : (
              <div className="space-y-4">
                <p className="text-[13.5px] leading-relaxed text-ink-2">{t("cloud.consentBody")}</p>
                <Checkbox label={t("cloud.consentCheck")} checked={consent} onChange={setConsent} />
                <Button variant="primary" disabled={!consent} loading={busy === "optin"} onClick={async () => { const s = await run("optin", () => api("cloud.setOptIn", { optedIn: true, consent })); if (s) setStatus(s); }}>
                  {t("cloud.optIn")}
                </Button>
              </div>
            )}
          </Card>

          <Card title={t("cloud.listTitle")} actions={<Button size="sm" loading={busy === "list"} onClick={async () => { const b = await run("list", () => api("cloud.list")); if (b) setBackups(b); }}>{t("cloud.load")}</Button>}>
            {progress && progress.operation === "restore" && <div className="mb-4"><ProgressBar p={progress} /></div>}
            {backups === null ? null : backups.length === 0 ? (
              <p className="text-[13.5px] text-ink-3">{t("cloud.listEmpty")}</p>
            ) : (
              <ul className="divide-y divide-[var(--hairline)]">
                {backups.map((b) => (
                  <li key={b.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5 text-[13.5px]">
                    <span>
                      {formatTimestamp(b.createdAt)} · {formatBytes(b.sizeBytes)} · HavenOS {b.appVersion}
                    </span>
                    <Button size="sm" loading={busy === `restore-${b.id}`} onClick={async () => { const i = await run(`restore-${b.id}`, () => api("cloud.restore", { id: b.id })); if (i) setInspection(i); }}>
                      {t("cloud.restore")}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      )}
      {included}
      <RestoreConfirm inspection={inspection} onClose={() => setInspection(null)} />
    </div>
  );
}
