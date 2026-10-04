import { Host } from "@expo/ui";
import { Button, Form, LabeledContent, Section, Text, Toggle } from "@expo/ui/swift-ui";
import { foregroundStyle, listRowBackground, scrollContentBackground, tint } from "@expo/ui/swift-ui/modifiers";
import * as Haptics from "expo-haptics";
import { router, type Href } from "expo-router";
import type { SFSymbol } from "sf-symbols-typescript";
import { call } from "~/core/host";
import { colors } from "../theme";
import { useCore } from "../use-core";

const row = [listRowBackground(colors.surface)];

function Link({ title, icon, href }: { title: string; icon: SFSymbol; href: Href }) {
  return <Button label={title} systemImage={icon} onPress={() => router.push(href)} modifiers={[...row, foregroundStyle(colors.ink)]} />;
}

function formatBytes(n: number): string {
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export default function MoreScreen() {
  const info = useCore("app.info", undefined);
  const sample = info.data?.workspace === "sample";

  const setSample = async (on: boolean) => {
    await call("workspace.switch", { workspace: on ? "sample" : "main" });
    void Haptics.selectionAsync();
  };

  return (
    <Host style={{ flex: 1 }}>
      <Form modifiers={[scrollContentBackground("hidden"), tint(colors.brassBright)]}>
        <Section title="Records">
          <Link title="Properties" icon="building.2" href="/properties" />
          <Link title="Tenants" icon="person.2" href="/tenants" />
          <Link title="Add a property" icon="plus.circle" href="/onboarding" />
          <Link title="New tenancy" icon="key" href="/tenancies/new" />
        </Section>
        <Section title="Short stays">
          <Link title="Calendar connections" icon="calendar.badge.clock" href="/settings/channels" />
        </Section>
        <Section
          title="Workspace"
          footer={<Text modifiers={[foregroundStyle(colors.ink3)]}>The sample workspace is a separate set of made-up records for trying HavenOS. Your own records are untouched.</Text>}
        >
          <Toggle label="Use sample workspace" systemImage="sparkles" isOn={sample} onIsOnChange={(on) => void setSample(on)} modifiers={row} />
        </Section>
        <Section title="App">
          <Link title="Settings" icon="gearshape" href="/settings" />
          {info.data && (
            <>
              <LabeledContent label="Version" modifiers={row}>
                <Text modifiers={[foregroundStyle(colors.ink2)]}>{info.data.appVersion}</Text>
              </LabeledContent>
              <LabeledContent label="Stored on this device" modifiers={row}>
                <Text modifiers={[foregroundStyle(colors.ink2)]}>{formatBytes(info.data.dbSizeBytes + info.data.attachmentBytes)}</Text>
              </LabeledContent>
            </>
          )}
        </Section>
      </Form>
    </Host>
  );
}
