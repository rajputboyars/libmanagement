/** The app's day boundary is India time (same as the server's attendance day key). */
const IST = "Asia/Kolkata";
export const istDay = (d: Date | string | number = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: IST }).format(new Date(d));
export const istHour = (d = new Date()) => Number(new Intl.DateTimeFormat("en-GB", { timeZone: IST, hour: "numeric", hourCycle: "h23" }).format(d));
export const greeting = (d = new Date()) => {
  const h = istHour(d);
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
};
export const clock = (d: Date | string | number) => new Date(d).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", timeZone: IST });
export const shortDate = (d: Date | string | number) => new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: IST });
export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0])
    .join("")
    .toUpperCase() || "?";
