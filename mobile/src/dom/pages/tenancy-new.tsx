"use dom";

import "../polyfills";
import "../havenos.css";
import Page from "@/app/(workspace)/tenancies/new/page";
import { DomHost, type DomHostProps } from "../host";

export default function NewTenancyScreen(props: DomHostProps) {
  return (
    <DomHost {...props}>
      <Page />
    </DomHost>
  );
}
