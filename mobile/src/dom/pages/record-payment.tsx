"use dom";

import "../polyfills";
import "../havenos.css";
import { RecordPaymentDialog } from "@/components/rent/record-payment-dialog";
import { DomHost, type DomHostProps } from "../host";

export default function RecordPaymentScreen(props: DomHostProps) {
  const tenancyId = new URLSearchParams(props.search).get("tenancyId");
  return (
    <DomHost {...props} padded={false} sheet>
      <RecordPaymentDialog open tenancyId={tenancyId} onClose={() => void props.navigate("", "back")} />
    </DomHost>
  );
}
