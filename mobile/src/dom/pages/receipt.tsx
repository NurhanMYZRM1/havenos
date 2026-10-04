"use dom";

import { useEffect } from "react";
import "../polyfills";
import "../havenos.css";
import Page from "@/app/receipt/page";
import { DomHost, snapshotHtml, type DomHostProps } from "../host";

/** The receipt as a standalone page, then the share sheet (Save to Files, Print, Mail…). */
async function sharePdf(props: DomHostProps): Promise<{ path: string } | null> {
  const article = document.querySelector("article");
  if (!article || !props.printHtml) return null;
  const receiptNo = article.querySelector("header .tabular-nums")?.textContent?.trim() ?? "receipt";
  const path = await props.printHtml(snapshotHtml(article), `Receipt-${receiptNo}.pdf`);
  return path ? { path } : null;
}

export default function ReceiptScreen(props: DomHostProps) {
  useEffect(() => {
    window.print = () => void sharePdf(props);
  }, [props]);
  return (
    <DomHost {...props} padded={false} local={{ "rent.saveReceiptPdf": async () => (await sharePdf(props), null) }}>
      <Page />
    </DomHost>
  );
}
