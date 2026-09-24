"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { CloudPanel } from "@/components/settings/cloud-panel";
import { RestoreConfirm } from "@/components/settings/restore-confirm";
import { Button, LinkButton } from "@/components/ui/button";
import { Field, FormError, Select, TextArea, TextInput } from "@/components/ui/field";
import { Icon } from "@/components/ui/icons";
import { Card, DetailList, LoadError, Loading, Notice, PageHeader, Tabs } from "@/components/ui/layout";
import { useToast } from "@/components/ui/toast";
import { api, errorMessage, notifyChanged } from "@/lib/api/client";
import type { BackupInspection, SettingsInput } from "@/lib/api/contract";
import { useApi, useMutation } from "@/lib/api/hooks";
import { EXPORT_DATASETS, type ExportDataset } from "@/lib/domain/enums";
import { formatBytes, formatTimestamp } from "@/lib/domain/format";
import { formatPhone } from "@/lib/domain/phone";
import { plural, t, type MessageKey } from "@/lib/i18n";

type Tab = "storage" | "cloud" | "business" | "sample" | "about";

function Storage({ autoAction }: { autoAction: string | null }) {
  const toast = useToast();
  const info = useApi("app.info", undefined);
  const settings = useApi("settings.get", undefined);
  const safety = useApi("backup.listSafety", undefined);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [inspection, setInspection] = useState<BackupInspection | null>(null);
  const [dataset, setDataset] = useState<ExportDataset>("payments");
  const ran = useRef(false);

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const backup = () =>
    run("backup", async () => {
      const r = await api("backup.create");
      if (r) {
        notifyChanged();
        toast({ tone: "success", message: t("settings.backupDone", { path: r.path }) });
      }
    });
  const restore = () =>
    run("inspect", async () => {
      const r = await api("backup.pickAndInspect");
      if (r) setInspection(r);
    });

  useEffect(() => {
    if (ran.current || !info.data) return;
    ran.current = true;
    if (autoAction === "backup" && info.data.workspace === "main") void backup();
    if (autoAction === "restore" && info.data.workspace === "main") void restore();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [info.data, autoAction]);

  if (info.error) return <LoadError message={info.error} onRetry={info.reload} />;
  if (!info.data || !settings.data) return <Loading />;
  const sample = info.data.workspace === "sample";

  return (
    <div className="space-y-4">
      <FormError message={error} />
      <Card title={t("settings.storageMode")}>
        <div className="flex items-start gap-3">
          <Icon name="hardDrive" size={22} className="mt-0.5 text-good" />
          <div>
            <p className="text-[15px] font-semibold">{t("settings.storageLocal")}</p>
            <p className="mt-1 max-w-2xl text-[13.5px] leading-relaxed text-ink-2">{t("settings.storageLocalHelp")}</p>
          </div>
        </div>
        <div className="mt-5">
          <DetailList
            items={[
              {
                label: t("settings.dataFolder"),
                value: (
                  <span className="flex flex-wrap items-center gap-2">
                    <code className="break-all rounded bg-surface-2 px-2 py-0.5 text-[12.5px]">{info.data.dataDir}</code>
                    <Button size="sm" variant="ghost" onClick={() => void run("open", () => api("app.openDataFolder").then(() => undefined))} icon={<Icon name="folder" size={14} />}>
                      {t("settings.openFolder")}
                    </Button>
                  </span>
                ),
              },
              { label: t("settings.dbSize"), value: formatBytes(info.data.dbSizeBytes) },
              { label: t("settings.attachments"), value: `${info.data.attachmentCount} · ${formatBytes(info.data.attachmentBytes)}` },
            ]}
          />
        </div>
      </Card>

      {sample ? (
        <Notice tone="info">{t("errors.sampleNoBackup")}</Notice>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title={t("settings.backupTitle")}>
            <p className="mb-4 text-[13.5px] leading-relaxed text-ink-2">{t("settings.backupHelp")}</p>
            <Button variant="primary" loading={busy === "backup"} onClick={() => void backup()} icon={<Icon name="download" size={15} />}>
              {busy === "backup" ? t("settings.backingUp") : t("settings.backupNow")}
            </Button>
            <p className="mt-3 text-[13px] text-ink-3">
              {settings.data.lastLocalBackupAt ? t("settings.lastBackup", { when: formatTimestamp(settings.data.lastLocalBackupAt) }) : t("dashboard.neverBackedUp")}
            </p>
          </Card>
          <Card title={t("settings.restoreTitle")}>
            <p className="mb-4 text-[13.5px] leading-relaxed text-ink-2">{t("settings.restoreHelp")}</p>
            <Button loading={busy === "inspect"} onClick={() => void restore()} icon={<Icon name="upload" size={15} />}>
              {busy === "inspect" ? t("settings.inspecting") : t("settings.restoreChoose")}
            </Button>
          </Card>
        </div>
      )}

      {!sample && (
        <Card title={t("settings.safetyTitle")}>
          <p className="mb-3 text-[13px] text-ink-3">{t("settings.safetyHelp")}</p>
          {(safety.data ?? []).length === 0 ? (
            <p className="text-[13.5px] text-ink-3">{t("settings.safetyEmpty")}</p>
          ) : (
            <ul className="divide-y divide-[var(--hairline)]">
              {safety.data!.map((b) => (
                <li key={b.path} className="flex flex-wrap items-center justify-between gap-3 py-2.5 text-[13.5px]">
                  <span className="min-w-0">
                    <span className="block truncate">{b.fileName}</span>
                    <span className="text-[12px] text-ink-3">{formatTimestamp(b.createdAt)} · {formatBytes(b.sizeBytes)}</span>
                  </span>
                  <Button size="sm" loading={busy === b.path} onClick={() => void run(b.path, async () => setInspection(await api("backup.inspectSafety", { path: b.path })))}>
                    {t("settings.restoreThis")}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      <Card title={t("settings.exportTitle")}>
        <p className="mb-4 text-[13.5px] text-ink-2">{t("settings.exportHelp")}</p>
        <div className="flex flex-wrap items-end gap-3">
          <Button
            variant="primary"
            loading={busy === "exportAll"}
            onClick={() =>
              void run("exportAll", async () => {
                const r = await api("export.all");
                if (r) toast({ tone: "success", message: t("settings.exportDone", { n: r.files, folder: r.folder }) });
              })
            }
            icon={<Icon name="folder" size={15} />}
          >
            {t("settings.exportAll")}
          </Button>
          <div className="w-56">
            <Select aria-label={t("settings.exportOne")} value={dataset} onChange={(e) => setDataset(e.target.value as ExportDataset)} options={EXPORT_DATASETS.map((d) => ({ value: d, label: t(`settings.datasets.${d}` as MessageKey) }))} />
          </div>
          <Button
            loading={busy === "exportOne"}
            onClick={() =>
              void run("exportOne", async () => {
                const r = await api("export.dataset", { dataset });
                if (r) toast({ tone: "success", message: t("settings.exported", { path: r.path }) });
              })
            }
          >
            {t("common.exportCsv")}
          </Button>
        </div>
      </Card>
      <RestoreConfirm inspection={inspection} onClose={() => setInspection(null)} />
    </div>
  );
}

function Business() {
  const toast = useToast();
  const settings = useApi("settings.get", undefined);
  const save = useMutation("settings.update");
  const [f, setF] = useState<SettingsInput | null>(null);
  useEffect(() => {
    if (settings.data && !f) {
      const s = settings.data;
      setF({ landlordName: s.landlordName, contactPhone: formatPhone(s.contactPhone), contactEmail: s.contactEmail, address: s.address, receiptNote: s.receiptNote });
    }
  }, [settings.data, f]);
  if (!f) return <Loading />;
  const set = (k: keyof SettingsInput) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <Card title={t("settings.tabs.business")}>
      <form
        noValidate
        className="grid max-w-3xl gap-4 sm:grid-cols-2"
        onSubmit={async (e) => {
          e.preventDefault();
          if (await save.run(f)) toast({ tone: "success", message: t("settings.saved") });
        }}
      >
        <p className="text-[13.5px] text-ink-2 sm:col-span-2">{t("settings.businessHelp")}</p>
        <Field label={t("settings.landlordName")} optional error={save.fields.landlordName} className="sm:col-span-2">
          <TextInput value={f.landlordName} onChange={set("landlordName")} />
        </Field>
        <Field label={t("settings.contactPhone")} optional error={save.fields.contactPhone} hint={t("tenants.phoneHint")}>
          <TextInput type="tel" value={f.contactPhone} onChange={set("contactPhone")} />
        </Field>
        <Field label={t("settings.contactEmail")} optional error={save.fields.contactEmail}>
          <TextInput type="email" value={f.contactEmail} onChange={set("contactEmail")} />
        </Field>
        <Field label={t("settings.address")} optional className="sm:col-span-2">
          <TextArea value={f.address} onChange={set("address")} rows={3} />
        </Field>
        <Field label={t("settings.receiptNote")} hint={t("settings.receiptNoteHint")} optional className="sm:col-span-2">
          <TextArea value={f.receiptNote} onChange={set("receiptNote")} rows={2} />
        </Field>
        <div className="sm:col-span-2">
          <FormError message={save.error} />
        </div>
        <div>
          <Button type="submit" variant="primary" loading={save.pending}>
            {t("common.saveChanges")}
          </Button>
        </div>
      </form>
    </Card>
  );
}

function Sample() {
  const info = useApi("app.info", undefined);
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const go = async (label: string, workspace: "main" | "sample", reset = false) => {
    setBusy(label);
    setError(null);
    try {
      await api("workspace.switch", { workspace, reset });
      notifyChanged();
      router.push("/dashboard");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };
  const inSample = info.data?.workspace === "sample";
  return (
    <Card title={t("settings.tabs.sample")}>
      <p className="mb-4 max-w-2xl text-[13.5px] leading-relaxed text-ink-2">{t("settings.sampleHelp")}</p>
      {inSample && <p className="mb-4 text-[13.5px] text-info">{t("settings.sampleActive")}</p>}
      <div className="flex flex-wrap gap-2.5">
        {inSample ? (
          <Button variant="primary" loading={busy === "leave"} onClick={() => void go("leave", "main")}>
            {t("sample.leave")}
          </Button>
        ) : (
          <Button variant="primary" loading={busy === "open"} onClick={() => void go("open", "sample")}>
            {t("settings.sampleOpen")}
          </Button>
        )}
        <Button loading={busy === "reset"} onClick={() => void go("reset", "sample", true)}>
          {t("settings.sampleReset")}
        </Button>
      </div>
      <div className="mt-3">
        <FormError message={error} />
      </div>
    </Card>
  );
}

/** Short-stay calendars: states the method honestly and links to the connections page. */
function ShortStayChannelsCard() {
  const channels = useApi("channels.list", undefined);
  const list = channels.data ?? [];
  const attention = list.filter((c) => c.health === "error" || c.health === "stale" || c.health === "feed_link_missing" || c.counts.conflicts > 0 || c.counts.missing > 0).length;
  return (
    <Card title={t("settings.integrations")}>
      <p className="text-[14px] font-medium">{t("shortStays.settingsCard.title")}</p>
      <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-2">{t("shortStays.settingsCard.body")}</p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <LinkButton href="/settings/channels/" size="sm" variant="primary" icon={<Icon name="calendar" size={14} />}>
          {t("shortStays.settingsCard.open")}
        </LinkButton>
        {channels.data && (
          <span className="text-[13px] text-ink-2">
            {list.length === 0 ? t("shortStays.settingsCard.none") : plural(list.length, "shortStays.settingsCard.countOne", "shortStays.settingsCard.countMany")}
            {attention > 0 && <span className="ml-2 font-medium text-warn">{t("shortStays.settingsCard.attention", { n: attention })}</span>}
          </span>
        )}
      </div>
    </Card>
  );
}

function About() {
  const info = useApi("app.info", undefined);
  if (!info.data) return <Loading />;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title={t("settings.about")}>
        <DetailList
          items={[
            { label: t("settings.aboutVersion"), value: t("settings.version", { v: info.data.appVersion }) },
            { label: t("settings.aboutDatabase"), value: t("settings.schema", { v: info.data.schemaVersion }) },
            { label: t("settings.aboutPlatform"), value: t("settings.platform", { p: info.data.platform }) },
            { label: t("settings.storageMode"), value: `${t("settings.storageLocal")} · ${t("settings.offline")}` },
          ]}
        />
      </Card>
      <ShortStayChannelsCard />
    </div>
  );
}

function SettingsInner() {
  const params = useSearchParams();
  const initial = (params.get("tab") as Tab) || "storage";
  const [tab, setTab] = useState<Tab>(initial);
  useEffect(() => setTab(initial), [initial]);
  return (
    <>
      <PageHeader title={t("settings.title")} />
      <Tabs<Tab>
        label={t("settings.title")}
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "storage", label: t("settings.tabs.storage") },
          { value: "cloud", label: t("settings.tabs.cloud") },
          { value: "business", label: t("settings.tabs.business") },
          { value: "sample", label: t("settings.tabs.sample") },
          { value: "about", label: t("settings.tabs.about") },
        ]}
      />
      <div role="tabpanel" className="pt-5">
        {tab === "storage" && <Storage autoAction={params.get("do")} />}
        {tab === "cloud" && <CloudPanel />}
        {tab === "business" && <Business />}
        {tab === "sample" && <Sample />}
        {tab === "about" && <About />}
      </div>
    </>
  );
}

export default function SettingsPage() {
  return (
    <Suspense fallback={<Loading />}>
      <SettingsInner />
    </Suspense>
  );
}
