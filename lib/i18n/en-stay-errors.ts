/** Errors raised by reservations, availability blocks and turnovers (errors.stays.*). */
export const stayErrors = {
  datesLocked: "These dates come from {channel}. Change them on {channel}; HavenOS will pick it up at the next sync.",
  statusLocked: "This booking's status comes from {channel}. Change it on {channel}, or cancel it here if it was cancelled there.",
  alreadyCancelled: "This reservation is already cancelled.",
  blockCancelled: "This block has been removed.",
  turnoverSkipped: "This turnover was skipped because the stay was cancelled.",
  duplicateReference: "Another {channel} reservation already uses the reference {code}.",
  calendarRange: "Show at most 120 days at a time.",
  checkOutAfterCheckIn: "Check-out must be at least one day after check-in.",
  stayTooLong: "A short stay can be at most 365 nights. For longer lets, add a tenancy.",
  guestCountRange: "Enter between 1 and 50 guests.",
  invalidTime: "Enter a time like 11:00 or 15:30.",
  checklistTooLong: "A checklist can have at most 40 items.",
  checklistLabel: "Each checklist item needs a label of up to 120 characters.",
  maintenanceOtherProperty: "Choose a maintenance request for the same property.",
  spaceUnavailable: "Choose a unit, room or bed that hasn't been archived.",
} as const;
