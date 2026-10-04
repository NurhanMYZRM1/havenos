import { Host, List, ListItem, Switch } from "@expo/ui";
import { router } from "expo-router";
import { call } from "~/core/host";
import { useCore } from "../use-core";

export default function MoreScreen() {
  const info = useCore("app.info", undefined);
  const sample = info.data?.workspace === "sample";
  return (
    <Host style={{ flex: 1 }}>
      <List>
        <ListItem onPress={() => router.push("/properties")}>Properties</ListItem>
        <ListItem onPress={() => router.push("/tenants")}>Tenants</ListItem>
        <ListItem onPress={() => router.push("/onboarding")}>Add a property</ListItem>
        <ListItem onPress={() => router.push("/tenancies/new")}>New tenancy</ListItem>
        <ListItem onPress={() => router.push("/settings/channels")}>Calendar connections</ListItem>
        <ListItem trailing={<Switch value={sample} onValueChange={(on) => void call("workspace.switch", { workspace: on ? "sample" : "main" })} />}>
          Use sample workspace
        </ListItem>
        <ListItem onPress={() => router.push("/settings")}>Settings</ListItem>
      </List>
    </Host>
  );
}
