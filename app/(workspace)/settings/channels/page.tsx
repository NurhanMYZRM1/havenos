"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { ConnectionDialog } from "@/components/settings/channels/connection-dialog";
import { ConnectionDetailView, ConnectionsList } from "@/components/settings/channels/connections";
import { methodLabel } from "@/components/stays/format";
import { SyncIndicator } from "@/components/stays/shared";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { LoadError, Loading, Notice, PageHeader } from "@/components/ui/layout";
import { useToast } from "@/components/ui/toast";
import { api, errorMessage, notifyChanged } from "@/lib/api/client";
import { useApi, useMutation } from "@/lib/api/hooks";
import { t } from "@/lib/i18n";

function SampleNote() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  return (
    <Notice
      tone="info"
      action={
        <Button
          size="sm"
          loading={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await api("workspace.switch", { workspace: "main" });
              notifyChanged();
            } catch (err) {
              toast({ tone: "error", message: errorMessage(err) });
            } finally {
              setBusy(false);
            }
          }}
        >
          {t("shortStays.connections.sampleLeave")}
        </Button>
      }
    >
      {t("shortStays.connections.sampleNote")}
    </Notice>
  );
}

function ListPage({ sample }: { sample: boolean }) {
  const toast = useToast();
  const refresh = useMutation("channels.refresh");
  const [adding, setAdding] = useState(false);
  return (
    <>
      <PageHeader
        back={{ href: "/settings?tab=about", label: t("shortStays.connections.back") }}
        title={t("shortStays.connections.title")}
        subtitle={t("shortStays.connections.subtitle")}
        actions={
          <>
            <SyncIndicator />
            <Button
              loading={refresh.pending}
              icon={<Icon name="history" size={15} />}
              onClick={async () => {
                if (await refresh.run({ id: null, acceptShrink: false })) toast({ tone: "success", message: t("shortStays.sync.refreshed") });
              }}
            >
              {t("shortStays.connections.refreshAll")}
            </Button>
            {!sample && (
              <Button variant="primary" onClick={() => setAdding(true)} icon={<Icon name="plus" size={15} />}>
                {t("shortStays.connections.add")}
              </Button>
            )}
          </>
        }
      />
      <div className="space-y-4">
        {sample && <SampleNote />}
        {refresh.error && <LoadError message={refresh.error} />}
        <ConnectionsList sample={sample} />
      </div>
      <ConnectionDialog open={adding} connection={null} onClose={() => setAdding(false)} />
    </>
  );
}

function DetailPage({ id, sample }: { id: string; sample: boolean }) {
  const detail = useApi("channels.get", { id });
  return (
    <>
      <PageHeader
        back={{ href: "/settings/channels/", label: t("shortStays.detail.back") }}
        eyebrow={detail.data ? methodLabel(detail.data) : t("shortStays.connections.title")}
        title={detail.data?.name ?? t("shortStays.connections.title")}
        subtitle={detail.data ? `${detail.data.spacePath} · ${detail.data.propertyName}` : undefined}
        actions={<SyncIndicator />}
      />
      {sample && (
        <div className="mb-4">
          <SampleNote />
        </div>
      )}
      {detail.error && <LoadError message={detail.error} onRetry={detail.reload} />}
      {!detail.data && !detail.error && <Loading />}
      {detail.data && <ConnectionDetailView d={detail.data} />}
    </>
  );
}

function ChannelsInner() {
  const id = useSearchParams().get("id");
  const info = useApi("app.info", undefined);
  const sample = info.data?.workspace === "sample";
  return id ? <DetailPage id={id} sample={sample} /> : <ListPage sample={sample} />;
}

export default function ChannelsPage() {
  return (
    <Suspense fallback={<Loading />}>
      <ChannelsInner />
    </Suspense>
  );
}
