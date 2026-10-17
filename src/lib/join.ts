import { randomInt } from "node:crypto";
import { Library } from "./models";
import { generateLibraryCode } from "./punch";

/** Gives a library its shareable Library ID if it does not have one yet (older libraries get it the first time the owner needs it). */
export async function ensureLibraryCode(libraryId: unknown): Promise<string | null> {
  const existing = await Library.findById(libraryId).select("libraryCode").lean<{ libraryCode?: string }>();
  if (!existing) return null;
  if (existing.libraryCode) return existing.libraryCode;
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      const updated = await Library.findOneAndUpdate({ _id: libraryId, libraryCode: { $exists: false } }, { $set: { libraryCode: generateLibraryCode((n) => randomInt(n)) } }, { new: true }).lean<{ libraryCode?: string }>();
      if (updated?.libraryCode) return updated.libraryCode;
      return (await Library.findById(libraryId).select("libraryCode").lean<{ libraryCode?: string }>())?.libraryCode ?? null; // another request set it first
    } catch (error) {
      if ((error as { code?: number }).code !== 11000) throw error; // code collision: try another
    }
  }
  return null;
}
export const newLibraryCode = () => generateLibraryCode((n) => randomInt(n));
