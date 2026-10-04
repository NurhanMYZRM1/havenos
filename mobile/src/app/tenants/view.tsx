import Screen from "~/dom/pages/tenant-view";
import { useDomProps } from "~/native/dom-props";

export default function Route() {
  return <Screen {...useDomProps()} />;
}
