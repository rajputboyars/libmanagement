"use client";
import { createContext, useContext } from "react";

/** The signed-in person's permission check for library screens. Absent (students, public pages) means "allowed": the server decides. */
const CanContext = createContext<((permission: string) => boolean) | null>(null);
export const CanProvider = CanContext.Provider;
export function useCan(): (permission: string) => boolean {
  return useContext(CanContext) ?? (() => true);
}
