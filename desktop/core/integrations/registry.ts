import type { ChannelId } from "../../../lib/domain/enums";
import { airbnbAdapter } from "./airbnb";
import type { CalendarFeedAdapter } from "./channels";
import { genericIcalAdapter } from "./generic-ical";

/**
 * Adapters HavenOS can sync today. Booking.com is deliberately absent: its
 * calendar export hasn't been checked, so it isn't offered.
 */
const ADAPTERS: Partial<Record<ChannelId, CalendarFeedAdapter>> = {
  airbnb: airbnbAdapter,
  other: genericIcalAdapter,
};

export function feedAdapter(channel: string): CalendarFeedAdapter | null {
  return Object.prototype.hasOwnProperty.call(ADAPTERS, channel) ? (ADAPTERS[channel as ChannelId] ?? null) : null;
}

export function supportedChannels(): ChannelId[] {
  return Object.keys(ADAPTERS) as ChannelId[];
}
