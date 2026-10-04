"use dom";

import "../polyfills";
import "../havenos.css";
import Page from "@/app/(workspace)/settings/page";
import { DomHost, type DomHostProps } from "../host";

export default function SettingsScreen(props: DomHostProps) {
  return (
    <DomHost {...props}>
      <Page />
    </DomHost>
  );
}
