"use client";

import Link from "next/link";
import { useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { EmptyIllustration } from "@/components/illustrations";
import { Button } from "@/components/ui/button";
import { Checkbox, Select } from "@/components/ui/field";
import { Icon } from "@/components/ui/icons";
import { EmptyState, LoadError, Loading } from "@/components/ui/layout";
import type { CalendarItem, CalendarRow } from "@/lib/api/contract";
import { useApi } from "@/lib/api/hooks";
import { addDays, daysBetween, isIsoDate, weekday, type IsoDate } from "@/lib/domain/dates";
import { formatDate } from "@/lib/domain/format";
import { t, type MessageKey } from "@/lib/i18n";
import { channelLabel, nightsLabel } from "./format";
import { ChannelHealthPill } from "./shared";
import { BlockDialog, QuickAddDialog, ReservationDialog } from "./stay-dialogs";

export const CALENDAR_DAYS = 30;
const DAY_W = 40;
const LANE_H = 28;
const LABEL_W = 200;

type Style = { box: CSSProperties; text: string };

const hatch = (color: string, alpha = 35) => `repeating-linear-gradient(135deg, color-mix(in oklab, ${color} ${alpha}%, transparent) 0 5px, transparent 5px 10px)`;

/** One visual language per kind/status, repeated in the legend. */
function styleFor(item: CalendarItem): Style {
  switch (item.kind) {
    case "reservation":
      if (item.status === "cancelled") return { box: { background: "var(--color-surface-3)", border: "1px solid var(--hairline-strong)" }, text: "text-ink-3 line-through" };
      if (item.status === "tentative") return { box: { background: "color-mix(in oklab, var(--color-info) 14%, transparent)", border: "1.5px solid var(--color-info)" }, text: "text-ink" };
      return { box: { background: "color-mix(in oklab, var(--color-brass) 78%, black)", border: "1px solid var(--color-brass-bright)" }, text: "text-[#15130f] font-semibold" };
    case "block":
      return { box: { background: `${hatch("var(--color-serious)", 45)}, color-mix(in oklab, var(--color-serious) 14%, var(--color-surface))`, border: "1px solid var(--color-serious)" }, text: "text-ink" };
    case "channel_block":
      return { box: { background: `${hatch("var(--color-ink-3)", 30)}, var(--color-surface-2)`, border: "1px solid var(--hairline-strong)" }, text: "text-ink-2" };
    case "tenancy":
      return { box: { background: "color-mix(in oklab, var(--color-info) 40%, var(--color-surface))", border: "1px solid color-mix(in oklab, var(--color-info) 70%, transparent)" }, text: "text-ink" };
    case "conflict":
      return { box: { background: `${hatch("#ffffff", 22)}, var(--color-critical)`, border: "2px solid #ffb4ae", boxShadow: "0 0 0 2px color-mix(in oklab, var(--color-critical) 45%, transparent)" }, text: "text-white font-semibold" };
  }
}

function decorate(item: CalendarItem, s: Style): Style {
  const box = { ...s.box };
  if (item.missing) {
    box.borderStyle = "dashed";
    box.borderWidth = 2;
    box.background = "color-mix(in oklab, var(--color-brass) 22%, transparent)";
    return { box, text: "text-ink" };
  }
  if (item.viaSpacePath) {
    box.opacity = 0.55;
    box.borderStyle = "dotted";
  }
  return { box, text: s.text };
}

function kindLabel(item: CalendarItem): string {
  if (item.kind === "channel_block") return t("shortStays.calendar.legend.channelBlock");
  if (item.kind === "reservation" && item.channel) return `${t("shortStays.enums.calendarKind.reservation")} (${channelLabel(item.channel)})`;
  return t(`shortStays.enums.calendarKind.${item.kind}` as MessageKey);
}

function itemDescription(item: CalendarItem): string {
  const tags = [
    item.status && item.status !== "confirmed" ? t(`shortStays.enums.reservationStatus.${item.status}` as MessageKey) : null,
    item.missing ? t("shortStays.calendar.missingTag") : null,
    item.viaSpacePath ? t("shortStays.calendar.via", { path: item.viaSpacePath }) : null,
  ].filter(Boolean);
  const base = t("shortStays.calendar.itemLabel", {
    kind: kindLabel(item),
    label: item.label || "—",
    start: formatDate(item.start),
    end: formatDate(item.endExclusive),
    nights: nightsLabel(daysBetween(item.start, item.endExclusive)),
  });
  return tags.length ? `${base} ${tags.join(" · ")}` : base;
}

/** Greedy lanes so overlapping items (e.g. a conflict over a booking) stack. */
function layout(items: CalendarItem[]): { item: CalendarItem; lane: number }[] {
  const sorted = [...items].sort((a, b) => (a.start === b.start ? (a.kind === "conflict" ? 1 : -1) : a.start < b.start ? -1 : 1));
  const laneEnds: string[] = [];
  return sorted.map((item) => {
    let lane = laneEnds.findIndex((end) => end <= item.start);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(item.endExclusive);
    } else laneEnds[lane] = item.endExclusive;
    return { item, lane };
  });
}

function Bar({ item, lane, from, days, onBlock }: { item: CalendarItem; lane: number; from: IsoDate; days: number; onBlock: (id: string) => void }) {
  const startIdx = daysBetween(from, item.start);
  const endIdx = daysBetween(from, item.endExclusive);
  // A night runs from the middle of its day to the middle of the next one.
  const rawLeft = startIdx * DAY_W + DAY_W / 2;
  const rawRight = endIdx * DAY_W + DAY_W / 2;
  const left = Math.max(0, rawLeft);
  const right = Math.min(days * DAY_W, rawRight);
  if (right <= left) return null;
  const s = decorate(item, styleFor(item));
  const style: CSSProperties = {
    ...s.box,
    position: "absolute",
    top: lane * LANE_H + 4,
    height: LANE_H - 6,
    left: left + 1,
    width: right - left - 2,
    borderTopLeftRadius: rawLeft < 0 ? 0 : 6,
    borderBottomLeftRadius: rawLeft < 0 ? 0 : 6,
    borderTopRightRadius: rawRight > days * DAY_W ? 0 : 6,
    borderBottomRightRadius: rawRight > days * DAY_W ? 0 : 6,
  };
  const description = itemDescription(item);
  const glyph = item.kind === "conflict" ? "▲ " : item.missing ? "? " : item.viaSpacePath ? "↕ " : "";
  const content = (
    <span className={`block truncate px-1.5 text-[12px] leading-[20px] ${s.text}`}>
      {rawLeft < 0 && "‹ "}
      {glyph}
      {item.label || kindLabel(item)}
    </span>
  );
  const cls = "overflow-hidden text-left hover:brightness-110 focus-visible:z-10";
  if (item.kind === "block" && !item.viaSpacePath) {
    return (
      <button type="button" className={cls} style={style} title={description} aria-label={description} onClick={() => onBlock(item.id)}>
        {content}
      </button>
    );
  }
  if (item.href) {
    return (
      <Link href={item.href} className={cls} style={style} title={description} aria-label={description}>
        {content}
      </Link>
    );
  }
  return (
    <span className={cls} style={style} title={description} role="img" aria-label={description}>
      {content}
    </span>
  );
}

function RowLabel({ row }: { row: CalendarRow }) {
  return (
    <div className="flex h-full flex-col justify-center gap-0.5 px-3 py-1.5">
      <div className="truncate text-[13px] font-medium" title={row.spacePath}>
        {row.spacePath}
      </div>
      <div className="truncate text-[11.5px] text-ink-3">{row.propertyName}</div>
      {row.connection ? (
        <Link href={`/settings/channels/?id=${row.connection.id}`} className="flex min-w-0 items-center gap-1.5 hover:underline" title={row.connection.name}>
          <span className="truncate text-[11.5px] text-ink-2">{row.connection.name}</span>
          <span className="shrink-0 scale-90 origin-left">
            <ChannelHealthPill health={row.connection.health} />
          </span>
        </Link>
      ) : (
        <div className="text-[11.5px] text-ink-3">{t("shortStays.calendar.noCalendar")}</div>
      )}
    </div>
  );
}

function Legend() {
  const swatch = (item: Partial<CalendarItem>) => {
    const full: CalendarItem = { kind: "reservation", id: "", start: "", endExclusive: "", label: "", status: "confirmed", channel: null, missing: false, viaSpacePath: null, href: null, ...item };
    return <span aria-hidden className="inline-block h-3.5 w-7 shrink-0 rounded" style={decorate(full, styleFor(full)).box} />;
  };
  const entries: [React.ReactNode, MessageKey][] = [
    [swatch({}), "shortStays.calendar.legend.confirmed"],
    [swatch({ status: "tentative" }), "shortStays.calendar.legend.tentative"],
    [swatch({ status: "cancelled" }), "shortStays.calendar.legend.cancelled"],
    [swatch({ kind: "block", status: null }), "shortStays.calendar.legend.block"],
    [swatch({ kind: "channel_block", status: null }), "shortStays.calendar.legend.channelBlock"],
    [swatch({ kind: "tenancy", status: null }), "shortStays.calendar.legend.tenancy"],
    [swatch({ kind: "conflict", status: null }), "shortStays.calendar.legend.conflict"],
    [swatch({ missing: true }), "shortStays.calendar.legend.missing"],
    [swatch({ viaSpacePath: "x" }), "shortStays.calendar.legend.inherited"],
  ];
  return (
    <div className="card px-4 py-3">
      <h3 className="microlabel mb-2">{t("shortStays.calendar.legendTitle")}</h3>
      <ul className="flex flex-wrap gap-x-5 gap-y-2 text-[12.5px] text-ink-2">
        {entries.map(([sw, key]) => (
          <li key={key} className="flex items-center gap-2">
            {sw}
            {t(key)}
          </li>
        ))}
      </ul>
      <p className="mt-2.5 text-[12px] text-ink-3">
        {t("shortStays.calendar.howToRead")} {t("shortStays.calendar.clickHint")}
      </p>
    </div>
  );
}

export function CalendarTab({
  from,
  today,
  onFrom,
  blockId,
  onBlock,
}: {
  from: IsoDate;
  today: IsoDate;
  onFrom: (d: IsoDate) => void;
  /** Block whose edit dialog is open (from `&block=`). */
  blockId: string | null;
  onBlock: (id: string | null) => void;
}) {
  const [propertyId, setPropertyId] = useState<string | null>(null);
  const [showCancelled, setShowCancelled] = useState(false);
  const [dayCount, setDayCount] = useState(CALENDAR_DAYS);
  const [focusedDay, setFocusedDay] = useState<string | null>(null);
  const dayButtons = useRef(new Map<string, HTMLButtonElement>());
  const [dialog, setDialog] = useState<null | { kind: "reservation" | "block"; spaceId?: string; date?: IsoDate }>(null);
  const [quick, setQuick] = useState<null | { spaceId: string; spaceLabel: string; date: IsoDate; dateLabel: string }>(null);
  const to = addDays(from, dayCount - 1);
  const properties = useApi("properties.list", { includeArchived: false });
  const calendar = useApi("stays.calendar", { from, to, propertyId, includeCancelled: showCancelled });

  const block = useApi("blocks.get", { id: blockId ?? "" }, { enabled: !!blockId });
  const editBlock = blockId && block.data?.id === blockId ? block.data : null;
  const blockMissing = !!blockId && !!block.error && !block.loading && !editBlock;

  const days = useMemo(() => Array.from({ length: dayCount }, (_, i) => addDays(from, i)), [from, dayCount]);
  const rows = calendar.data?.rows ?? [];
  const activeDay = focusedDay && rows.some((row) => days.some((date) => `${row.spaceId}:${date}` === focusedDay)) ? focusedDay : rows[0] ? `${rows[0].spaceId}:${from}` : null;

  const openDay = (row: CalendarRow, date: IsoDate) => {
    setQuick({ spaceId: row.spaceId, spaceLabel: row.spacePath, date, dateLabel: formatDate(date) });
  };
  const moveDay = (e: KeyboardEvent<HTMLButtonElement>, rowIndex: number, dayIndex: number) => {
    let nextRow = rowIndex;
    let nextDay = dayIndex;
    if (e.key === "ArrowLeft") nextDay--;
    else if (e.key === "ArrowRight") nextDay++;
    else if (e.key === "ArrowUp") nextRow--;
    else if (e.key === "ArrowDown") nextRow++;
    else if (e.key === "Home") nextDay = 0;
    else if (e.key === "End") nextDay = days.length - 1;
    else return;
    e.preventDefault();
    const key = `${rows[Math.max(0, Math.min(rows.length - 1, nextRow))].spaceId}:${days[Math.max(0, Math.min(days.length - 1, nextDay))]}`;
    setFocusedDay(key);
    dayButtons.current.get(key)?.focus();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex items-center gap-2" role="group" aria-label={t("shortStays.calendar.startFrom")}>
          <Button size="sm" onClick={() => onFrom(addDays(from, -dayCount))} icon={<Icon name="chevronLeft" size={14} />}>
            {t("shortStays.calendar.earlier")}
          </Button>
          <input type="date" className="control tnum !w-auto" value={from} aria-label={t("shortStays.calendar.startFrom")} onChange={(e) => isIsoDate(e.target.value) && onFrom(e.target.value)} />
          <Button size="sm" onClick={() => onFrom(addDays(from, dayCount))}>
            {t("shortStays.calendar.later")}
            <Icon name="chevronRight" size={14} />
          </Button>
          {from !== today && (
            <button type="button" onClick={() => onFrom(today)} className="rounded-lg px-2.5 py-1.5 text-[13px] font-medium text-brass-bright hover:bg-surface-2">
              {t("common.today")}
            </button>
          )}
        </div>
        <div className="w-32">
          <Select aria-label={t("shortStays.calendar.days")} value={String(dayCount)} onChange={(e) => setDayCount(Number(e.target.value))} options={[14, 30, 60].map((count) => ({ value: String(count), label: t("shortStays.calendar.dayCount", { count }) }))} />
        </div>
        <output className="tnum pb-1.5 text-[13.5px] text-ink-2" aria-live="polite">
          {t("shortStays.calendar.range", { start: formatDate(from), end: formatDate(to) })}
        </output>
        <div className="ml-auto flex flex-wrap items-end gap-3">
          <div className="w-52">
            <Select aria-label={t("shortStays.calendar.property")} value={propertyId ?? ""} onChange={(e) => setPropertyId(e.target.value || null)} options={[{ value: "", label: t("shortStays.calendar.allProperties") }, ...(properties.data ?? []).map((p) => ({ value: p.id, label: p.name }))]} />
          </div>
          <div className="pb-2.5">
            <Checkbox label={t("shortStays.calendar.showCancelled")} checked={showCancelled} onChange={setShowCancelled} />
          </div>
        </div>
      </div>

      {calendar.error && <LoadError message={calendar.error} onRetry={calendar.reload} />}
      {!calendar.data && !calendar.error && <Loading />}
      {calendar.data && rows.length === 0 && (
        <div className="card">
          <EmptyState illustration={<EmptyIllustration kind="home" />} title={t("shortStays.calendar.empty")} body={t("shortStays.calendar.emptyBody")} />
        </div>
      )}
      {calendar.data && rows.length > 0 && (
        <div className="card">
          <p className="hairline-b px-3 py-2 text-[12px] text-ink-3">{t("shortStays.calendar.scrollHint")} {t("shortStays.calendar.keyboardHint")}</p>
          <div className="overflow-x-auto">
            <div className="relative" style={{ width: LABEL_W + dayCount * DAY_W }}>
              {/* Weekend and today shading behind every row. */}
              <div aria-hidden className="pointer-events-none absolute bottom-0 top-0" style={{ left: LABEL_W, width: dayCount * DAY_W }}>
                {days.map((d, i) => {
                  const we = weekday(d) === 0 || weekday(d) === 6;
                  if (!we && d !== today) return null;
                  return <div key={d} className="absolute bottom-0 top-0" style={{ left: i * DAY_W, width: DAY_W, background: d === today ? "color-mix(in oklab, var(--color-brass) 12%, transparent)" : "rgba(245,244,240,0.025)", borderLeft: d === today ? "1px solid color-mix(in oklab, var(--color-brass) 60%, transparent)" : undefined }} />;
                })}
              </div>
              {/* Header */}
              <div className="hairline-b sticky top-0 z-20 flex bg-surface">
                <div className="sticky left-0 z-10 flex items-end bg-surface px-3 pb-2" style={{ width: LABEL_W, minWidth: LABEL_W }}>
                  <span className="microlabel">{t("shortStays.calendar.spaceColumn")}</span>
                </div>
                {days.map((d, i) => {
                  const dayNum = Number(d.slice(8, 10));
                  const showMonth = i === 0 || dayNum === 1;
                  return (
                    <div key={d} className={`relative flex flex-col items-center pb-1.5 pt-5 ${d === today ? "text-brass-bright" : "text-ink-3"}`} style={{ width: DAY_W, minWidth: DAY_W }}>
                      {showMonth && <span className="absolute left-1 top-1 whitespace-nowrap text-[11px] font-semibold text-ink-2">{t(`months.short.${d.slice(5, 7)}` as MessageKey)}</span>}
                      <span className="text-[10.5px] uppercase">{t(`shortStays.calendar.weekdayShort.${weekday(d)}` as MessageKey)}</span>
                      <span className={`tnum text-[13px] ${d === today ? "font-bold" : "font-medium text-ink-2"}`}>{dayNum}</span>
                    </div>
                  );
                })}
              </div>
              {/* Rows */}
              <ul>
                {rows.map((row, rowIndex) => {
                  const placed = layout(row.items);
                  const lanes = Math.max(1, ...placed.map((p) => p.lane + 1));
                  const height = Math.max(78, lanes * LANE_H + 8);
                  return (
                    <li key={row.spaceId} className="hairline-b flex last:border-b-0" style={{ height }}>
                      <div className="sticky left-0 z-10 border-r border-[var(--hairline)] bg-surface" style={{ width: LABEL_W, minWidth: LABEL_W }}>
                        <RowLabel row={row} />
                      </div>
                      <div
                        className="relative"
                        style={{ width: dayCount * DAY_W, backgroundImage: `repeating-linear-gradient(to right, transparent 0 ${DAY_W - 1}px, var(--hairline) ${DAY_W - 1}px ${DAY_W}px)` }}
                      >
                        {days.map((date, dayIndex) => {
                          const key = `${row.spaceId}:${date}`;
                          return <button key={date} type="button" ref={(el) => { if (el) dayButtons.current.set(key, el); else dayButtons.current.delete(key); }} className="absolute inset-y-0 cursor-cell hover:bg-surface-3/30 focus-visible:z-20 focus-visible:outline-offset-[-3px]" style={{ left: dayIndex * DAY_W, width: DAY_W }} tabIndex={activeDay === key ? 0 : -1} aria-label={t("shortStays.calendar.dayAction", { date: formatDate(date), space: row.spacePath })} onFocus={() => setFocusedDay(key)} onKeyDown={(e) => moveDay(e, rowIndex, dayIndex)} onClick={() => openDay(row, date)} />;
                        })}
                        {placed.map(({ item, lane }) => (
                          <Bar key={`${item.kind}-${item.id}-${item.start}`} item={item} lane={lane} from={from} days={dayCount} onBlock={(id) => onBlock(id)} />
                        ))}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
        </div>
      )}
      <Legend />

      <QuickAddDialog
        target={quick}
        onClose={() => setQuick(null)}
        onPick={(kind) => {
          if (quick) setDialog({ kind, spaceId: quick.spaceId, date: quick.date });
          setQuick(null);
        }}
      />
      <ReservationDialog open={dialog?.kind === "reservation"} reservation={null} defaults={{ spaceId: dialog?.spaceId, checkIn: dialog?.date }} onClose={() => setDialog(null)} />
      <BlockDialog open={dialog?.kind === "block"} block={null} defaults={{ spaceId: dialog?.spaceId, startDate: dialog?.date }} onClose={() => setDialog(null)} />
      <BlockDialog open={!!editBlock} block={editBlock} onClose={() => onBlock(null)} />
      {blockMissing && (
        <div role="alert" className="fixed bottom-5 left-1/2 z-50 -translate-x-1/2">
          <div className="card flex items-center gap-3 px-4 py-3 shadow-xl">
            <Icon name="alert" className="text-warn" />
            <span className="text-[13.5px]">{t("shortStays.block.notFound")}</span>
            <Button size="sm" onClick={() => onBlock(null)}>
              {t("common.close")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Header actions for the calendar (and other tabs): add a reservation or block. */
export function StayAddActions() {
  const [dialog, setDialog] = useState<"reservation" | "block" | null>(null);
  return (
    <>
      <Button variant="primary" onClick={() => setDialog("reservation")} icon={<Icon name="plus" size={15} />}>
        {t("shortStays.actions.addReservation")}
      </Button>
      <Button onClick={() => setDialog("block")} icon={<Icon name="calendar" size={15} />}>
        {t("shortStays.actions.blockDates")}
      </Button>
      <ReservationDialog open={dialog === "reservation"} reservation={null} onClose={() => setDialog(null)} />
      <BlockDialog open={dialog === "block"} block={null} onClose={() => setDialog(null)} />
    </>
  );
}
