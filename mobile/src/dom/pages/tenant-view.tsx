"use dom";

import "../polyfills";
import "../havenos.css";
import Page from "@/app/(workspace)/tenants/view/page";
import { DomHost, type DomHostProps } from "../host";

export default function TenantViewScreen(props: DomHostProps) {
  return (
    <DomHost {...props}>
      <Page />
    </DomHost>
  );
}
