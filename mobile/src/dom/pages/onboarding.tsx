"use dom";

import "../polyfills";
import "../havenos.css";
import Page from "@/app/(workspace)/onboarding/page";
import { DomHost, type DomHostProps } from "../host";

export default function OnboardingScreen(props: DomHostProps) {
  return (
    <DomHost {...props}>
      <Page />
    </DomHost>
  );
}
