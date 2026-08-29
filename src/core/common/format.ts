/** Formats a minor-unit amount (pesewas/kobo) into a display string, e.g. "GHS 35.00". */
export function formatAmount(minorUnits: number, currency: string): string {
  return `${currency} ${(minorUnits / 100).toFixed(2)}`;
}
