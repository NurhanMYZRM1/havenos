"use dom";

import { useState } from "react";
import "../polyfills";
import "../havenos.css";
import { CalendarTab, StayAddActions } from "@/components/stays/calendar-tab";
import { todayInMalaysia, type IsoDate } from "@/lib/domain/dates";
import { DomHost, type DomHostProps } from "../host";

/** The desktop's booking calendar inside the native Stays screen. */
export default function StaysCalendar(props: DomHostProps) {
  const today = todayInMalaysia();
  const [from, setFrom] = useState<IsoDate>(today);
  const [blockId, setBlockId] = useState<string | null>(null);
  return (
    <DomHost {...props}>
      <div className="mb-4 flex flex-wrap gap-2.5">
        <StayAddActions />
      </div>
      <CalendarTab from={from} today={today} onFrom={setFrom} blockId={blockId} onBlock={setBlockId} />
    </DomHost>
  );
}
