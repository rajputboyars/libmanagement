"use client";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { Json } from "@/components/prep-api";

export const PAGE_SIZE = 25;
/** The workspace payload carries at most this many rows per resource (newest first). */
export const WORKSPACE_CAP = 100;

/**
 * Rows for an owner list. When the workspace payload is complete (fewer than the cap) every filter and
 * search can run exactly on the client. Past the cap the list pages from the server (same endpoint and
 * cache key as before) and only server-side search is offered, so filters never pretend to cover rows they cannot see.
 */
export function useRecords(section: string, local: Json[], preview: boolean, search: string) {
  const complete = preview || local.length < WORKSPACE_CAP;
  const [page, setPage] = useState(1);
  const q = useQuery<{ records: Json[]; total: number }>({
    queryKey: ["workspace", section, page, search],
    enabled: !complete,
    queryFn: async () => {
      const res = await fetch(`/api/workspace?resource=${section}&page=${page}&q=${encodeURIComponent(search)}`);
      if (!res.ok) throw new Error("Unable to load records");
      return res.json();
    },
  });
  return { complete, page, setPage, query: q, local };
}
