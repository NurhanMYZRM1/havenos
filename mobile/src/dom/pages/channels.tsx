"use dom";

import "../polyfills";
import "../havenos.css";
import Page from "@/app/(workspace)/settings/channels/page";
import { DomHost, type DomHostProps } from "../host";

export default function ChannelsScreen(props: DomHostProps) {
  return (
    <DomHost {...props}>
      <Page />
    </DomHost>
  );
}
