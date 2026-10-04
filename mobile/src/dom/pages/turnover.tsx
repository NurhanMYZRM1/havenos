"use dom";

import "../polyfills";
import "../havenos.css";
import Page from "@/app/(workspace)/stays/turnover/page";
import { DomHost, type DomHostProps } from "../host";

export default function TurnoverScreen(props: DomHostProps) {
  return (
    <DomHost {...props}>
      <Page />
    </DomHost>
  );
}
