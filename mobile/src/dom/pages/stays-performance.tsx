"use dom";

import "../polyfills";
import "../havenos.css";
import { PerformanceTab } from "@/components/stays/performance-tab";
import { todayInMalaysia } from "@/lib/domain/dates";
import { DomHost, type DomHostProps } from "../host";

/** The desktop's short-stay money charts inside the native Stays screen. */
export default function StaysPerformance(props: DomHostProps) {
  return (
    <DomHost {...props}>
      <PerformanceTab today={todayInMalaysia()} />
    </DomHost>
  );
}
