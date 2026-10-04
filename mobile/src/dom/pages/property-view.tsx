"use dom";

import "../polyfills";
import "../havenos.css";
import Page from "@/app/(workspace)/properties/view/page";
import { DomHost, type DomHostProps } from "../host";

export default function PropertyViewScreen(props: DomHostProps) {
  return (
    <DomHost {...props}>
      <Page />
    </DomHost>
  );
}
