import Screen from "~/dom/pages/tenancy-view";
import { useDomProps } from "~/native/dom-props";

export default function Route() {
  return <Screen {...useDomProps()} />;
}
