import { NativeTabs } from "expo-router/unstable-native-tabs";
import { colors } from "~/native/theme";

// The phone is for running the day: money in, today's stays, repairs on site.
// Setting up properties and tenants lives under More.
export default function TabsLayout() {
  return (
    <NativeTabs tintColor={colors.brassBright} minimizeBehavior="onScrollDown">
      <NativeTabs.Trigger name="dashboard">
        <NativeTabs.Trigger.Label>Home</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: "house", selected: "house.fill" }} md="home" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="rent">
        <NativeTabs.Trigger.Label>Rent</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: "banknote", selected: "banknote.fill" }} md="payments" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="stays">
        <NativeTabs.Trigger.Label>Stays</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: "calendar", selected: "calendar" }} md="calendar_month" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="maintenance">
        <NativeTabs.Trigger.Label>Maintenance</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: "wrench.and.screwdriver", selected: "wrench.and.screwdriver.fill" }} md="build" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="more">
        <NativeTabs.Trigger.Label>More</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: "ellipsis.circle", selected: "ellipsis.circle.fill" }} md="more_horiz" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
