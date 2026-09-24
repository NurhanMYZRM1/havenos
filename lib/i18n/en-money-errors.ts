/** Errors raised by the short-stay ledger and CSV imports (errors.money.*). */
export const moneyErrors = {
  notAirbnbCsv: "This file isn't an Airbnb earnings or reservations export. In Airbnb, go to Earnings → Transaction history and choose Export CSV.",
  emptyCsv: "This file has no rows to import.",
  importExpired: "This import preview has expired. Choose the file again.",
  negativeAmount: "Only adjustments can be negative.",
  entryVoided: "This entry has been voided.",
} as const;
