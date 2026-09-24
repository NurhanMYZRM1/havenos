/**
 * Errors raised by channel connections and calendar sync (errors.channels.*).
 * Never interpolate a feed link into these: links are secrets.
 */
export const channelErrors = {
  invalidFeedUrl: "That doesn't look like a calendar link. Copy the full link that ends in .ics.",
  feedUrlNotHttps: "The calendar link must start with https://.",
  feedUrlWrongChannel: "That link isn't an Airbnb calendar export link. In Airbnb, open Calendar → Availability → Connect calendars → Connect to another website, and copy the link shown there.",
  feedUrlNotPublic: "HavenOS can only read calendar links on the public internet.",
  feedUrlTooLong: "That link is too long to be a calendar link.",
  duplicateFeed: "This calendar link is already connected as “{name}”.",
  duplicateListing: "That Airbnb listing is already connected as “{name}”.",
  spaceTaken: "{space} already has a {channel} connection (“{name}”). Each space can have one connection per channel.",
  notLettable: "Choose the unit, room or bed this listing rents out.",
  removed: "This connection was removed.",
  credentialStore: "This computer's secure storage isn't available, so HavenOS can't keep the calendar link safely. It will be kept only until HavenOS closes.",
  unsupportedChannel: "HavenOS can't connect to this channel yet.",
  sampleWorkspace: "Calendar links can only be connected in your own records, not in the sample workspace.",
  invalidTime: "Enter a time like 15:00.",
  checklistTooLong: "A checklist can have up to 40 items.",
  eventNotPending: "This booking isn't waiting for review any more.",
  notReplaceable: "HavenOS can only replace manual blocks and direct bookings. Change or cancel the other records first, then try again.",
  replacedBy: "Replaced by {channel} booking {code}",
  replacedByNoCode: "Replaced by a {channel} booking",
  channelName: {
    airbnb: "Airbnb",
    booking_com: "Booking.com",
    other: "calendar",
    direct: "direct",
  },
} as const;
