"use dom";

import "../polyfills";
import "../havenos.css";
import Page from "@/app/(workspace)/maintenance/view/page";
import { DomHost, type DomHostProps } from "../host";

export default function MaintenanceViewScreen(props: DomHostProps) {
  return (
    <DomHost {...props}>
      <Page />
    </DomHost>
  );
}
