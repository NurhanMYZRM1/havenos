import Screen from "~/dom/pages/receipt";
import { useDomProps } from "~/native/dom-props";

export default function Route() {
  return <Screen {...useDomProps()} />;
}
