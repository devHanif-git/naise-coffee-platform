import type { OrderStatus } from "@/types/order";

// The filter tabs on the manage screen. "In Progress" maps to the `preparing`
// (and `ready`) statuses; "Completed" includes cancelled so finished orders
// don't linger in the active tabs.
export type OrderFilter = "all" | "pending" | "in_progress" | "completed";

export const orderFilters: { value: OrderFilter; label: string }[] = [
  { value: "all", label: "All Orders" },
  { value: "pending", label: "Pending" },
  { value: "in_progress", label: "In Progress" },
  { value: "completed", label: "Completed" },
];

export function matchesFilter(status: OrderStatus, filter: OrderFilter): boolean {
  switch (filter) {
    case "all":
      return true;
    case "pending":
      return status === "pending";
    case "in_progress":
      return status === "preparing" || status === "ready";
    case "completed":
      return status === "completed" || status === "cancelled";
  }
}

// Visual treatment for each status pill. Colors stay within the app's accent
// palette (amber = waiting, blue = active, emerald = done, rose = cancelled).
export const statusDisplay: Record<
  OrderStatus,
  { label: string; dot: string; pill: string }
> = {
  pending: {
    label: "Pending",
    dot: "bg-amber-500",
    pill: "bg-amber-50 text-amber-700",
  },
  preparing: {
    label: "In Progress",
    dot: "bg-blue-500",
    pill: "bg-blue-50 text-blue-700",
  },
  ready: {
    label: "Ready",
    dot: "bg-blue-500",
    pill: "bg-blue-50 text-blue-700",
  },
  completed: {
    label: "Completed",
    dot: "bg-emerald-500",
    pill: "bg-emerald-50 text-emerald-700",
  },
  cancelled: {
    label: "Cancelled",
    dot: "bg-rose-500",
    pill: "bg-rose-50 text-rose-700",
  },
};

// The three steps of the linear fulfilment flow, used by the progress tracker.
export const progressSteps: { key: OrderStatus; label: string }[] = [
  { key: "pending", label: "Received" },
  { key: "preparing", label: "Making" },
  { key: "completed", label: "Ready" },
];

// How far through the flow a status sits (index into progressSteps), so the
// tracker can fill completed steps. Cancelled has no position (returns -1).
export function progressIndex(status: OrderStatus): number {
  switch (status) {
    case "pending":
      return 0;
    case "preparing":
    case "ready":
      return 1;
    case "completed":
      return 2;
    case "cancelled":
      return -1;
  }
}

// "2 mins ago" style relative label from an ISO timestamp.
export function timeAgo(iso: string, now: number = Date.now()): string {
  const diffMs = now - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return "Just now";
  if (mins === 1) return "1 min ago";
  if (mins < 60) return `${mins} mins ago`;
  const hours = Math.floor(mins / 60);
  if (hours === 1) return "1 hour ago";
  if (hours < 24) return `${hours} hours ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "1 day ago" : `${days} days ago`;
}
