"use dom";

import "../polyfills";
import "../havenos.css";
import Page from "@/app/(workspace)/stays/reservation/page";
import { DomHost, type DomHostProps } from "../host";

export default function ReservationScreen(props: DomHostProps) {
  return (
    <DomHost {...props}>
      <Page />
    </DomHost>
  );
}
