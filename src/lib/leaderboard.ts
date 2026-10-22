// Opt-in library leaderboard: focused study minutes this week (Monday 00:00 India time onwards).
const IST_OFFSET_MS = 330 * 60000;

/** Monday 00:00 in India, as a UTC Date. */
export function weekStart(now = new Date()) {
  const ist = new Date(+now + IST_OFFSET_MS);
  const day = (ist.getUTCDay() + 6) % 7; // 0 = Monday
  const mondayIst = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate() - day);
  return new Date(mondayIst - IST_OFFSET_MS);
}

export type BoardRow = { userId: string; name: string; minutes: number };

/** Sorted ranks (ties share a rank), top N, and the viewer's own row even outside the top. */
export function rankBoard(rows: BoardRow[], me: string, top = 20) {
  const sorted = [...rows].sort((a, b) => b.minutes - a.minutes || a.name.localeCompare(b.name));
  let rank = 0;
  let prev = -1;
  const ranked = sorted.map((r, i) => {
    if (r.minutes !== prev) {
      rank = i + 1;
      prev = r.minutes;
    }
    return { ...r, rank, me: r.userId === me };
  });
  return { top: ranked.slice(0, top), mine: ranked.find((r) => r.me) ?? null, players: ranked.length };
}
