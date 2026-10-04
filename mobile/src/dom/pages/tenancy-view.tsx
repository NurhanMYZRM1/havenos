"use dom";

import "../polyfills";
import "../havenos.css";
import Page from "@/app/(workspace)/tenancies/view/page";
import { DomHost, type DomHostProps } from "../host";

export default function TenancyViewScreen(props: DomHostProps) {
  return (
    <DomHost {...props}>
      <Page />
    </DomHost>
  );
}
