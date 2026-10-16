export const ISSUE_CATEGORIES = ["furniture", "electrical", "wifi", "cooling", "cleanliness", "safety", "other"] as const;
export const ISSUE_PRIORITIES = ["low", "medium", "high", "urgent"] as const;
export const ISSUE_STATUSES = ["open", "assigned", "in-progress", "resolved", "cancelled"] as const;
export type IssueStatus = (typeof ISSUE_STATUSES)[number];
export const MAX_REPAIR_COST_PAISE = 10_000_000;

const transitions: Record<IssueStatus, IssueStatus[]> = {
  open: ["assigned", "in-progress", "resolved", "cancelled"],
  assigned: ["in-progress", "resolved", "cancelled"],
  "in-progress": ["resolved", "cancelled"],
  resolved: ["in-progress"],
  cancelled: [],
};

export function canTransition(from: IssueStatus, to: IssueStatus) {
  return transitions[from]?.includes(to) ?? false;
}

export const isActiveIssue = (status: string) => !["resolved", "cancelled"].includes(status);

/** A seat stays out of service while any active issue is flagged to take it offline. */
export function seatShouldBeOffline(issues: { status: string; seatOffline: boolean }[]) {
  return issues.some((issue) => issue.seatOffline && isActiveIssue(issue.status));
}

const priorityRank = { urgent: 0, high: 1, medium: 2, low: 3 } as const;
export function sortByUrgency<T extends { priority: keyof typeof priorityRank; createdAt: Date | string }>(issues: T[]) {
  return [...issues].sort((a, b) => priorityRank[a.priority] - priorityRank[b.priority] || +new Date(a.createdAt) - +new Date(b.createdAt));
}
