import { Library, Notification, User } from "./models";
import { JoinRequest } from "./ops-models";
import { normalizeLibraryCode } from "./punch";
import { accessForLibrary } from "./saas-server";

/** Shared by the join endpoint and registration: validates the Library ID and records a pending request for the owner to verify. */
export async function createJoinRequest(userId: unknown, rawCode: string, message = "") {
  const code = normalizeLibraryCode(rawCode);
  if (!code) throw new Error("That Library ID is not valid. It looks like LIB-AB12CD.");
  const [student, library] = await Promise.all([User.findById(userId).select("role libraryId deletedAt name").lean<{ role: string; libraryId?: unknown; deletedAt?: Date; name: string }>(), Library.findOne({ libraryCode: code }).select("name ownerId").lean<{ _id: unknown; name: string; ownerId: unknown }>()]);
  if (!student || student.role !== "student" || student.deletedAt) throw new Error("Only student accounts can join a library");
  if (!library) throw new Error("No library found with that ID. Check it with the library desk.");
  if (student.libraryId) throw new Error("You already belong to a library");
  const access = await accessForLibrary(library._id as never);
  if (access?.org.status === "suspended") throw new Error("This library is not accepting new students right now");
  const record = await JoinRequest.create({ libraryId: library._id, userId, message });
  await Notification.create({ userId: library.ownerId, libraryId: library._id, title: "New student registration to verify", message: `${student.name} used your Library ID. Review it under Join requests.` });
  return record;
}
