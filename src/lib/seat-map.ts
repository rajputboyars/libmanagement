export type SeatState = "available" | "booked" | "assigned" | "occupied" | "maintenance";
export type Holder = { shiftStart?: number; shiftEnd?: number; inside: boolean };

/** Minutes since local midnight in the library's zone (shift times are stored the same way). */
export function localMinutes(d: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(d);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return get("hour") * 60 + get("minute");
}
export const onShift = (h: Holder, minute: number) => h.shiftStart === undefined || h.shiftEnd === undefined || (h.shiftStart <= minute && h.shiftEnd > minute);

/**
 * occupied    = a student who holds the seat is punched in right now
 * assigned    = held for the current shift, nobody punched in yet
 * booked      = held only for other shifts today (free to use now)
 * maintenance = taken out of service
 */
export function seatState(operationalStatus: string | undefined, holders: Holder[], minute: number): SeatState {
  if (operationalStatus === "maintenance") return "maintenance";
  if (holders.some((h) => h.inside)) return "occupied";
  if (holders.some((h) => onShift(h, minute))) return "assigned";
  return holders.length ? "booked" : "available";
}
