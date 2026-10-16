import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { currentUser, limited, validOrigin } from "@/lib/auth";
import { offerExpiry } from "@/lib/waitlist";
import { Library, LibraryVisitRequest, MembershipPlan, Notification, Seat, SeatAssignment, SeatWaitlist, Shift } from "@/lib/models";

const objectId = z.string().regex(/^[a-f\d]{24}$/i);
const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

async function expireStaleOffers(filter: Record<string, unknown> = {}) {
  await SeatWaitlist.updateMany({ ...filter, status: { $in: ["offered", "accepted"] }, offerExpiresAt: { $lte: new Date() } }, { status: "expired" });
}

async function publicLibrary(library: Record<string, unknown>) {
  const libraryId = library._id;
  const now = new Date();
  const [seats, assignedSeatIds, plans, shifts] = await Promise.all([
    Seat.find({ libraryId, operationalStatus: { $ne: "maintenance" } }).select("label floor").lean(),
    SeatAssignment.distinct("seatId", { libraryId, start: { $lte: now }, end: { $gt: now } }),
    MembershipPlan.find({ libraryId }).sort({ amount: 1 }).lean(),
    Shift.find({ libraryId }).sort({ start: 1 }).lean(),
  ]);
  const occupied = new Set(assignedSeatIds.map(String));
  return {
    _id: library._id, name: library.name, publicSlug: library.publicSlug, city: library.city,
    address: library.address, publicDescription: library.publicDescription, facilities: library.facilities || [],
    availableSeats: seats.filter((seat) => !occupied.has(String(seat._id))).length,
    totalOperationalSeats: seats.length, feeFrom: plans[0]?.amount ?? null,
    plans: plans.map((plan) => ({ _id: plan._id, name: plan.name, amount: plan.amount, days: plan.days })),
    shifts: shifts.map((shift) => ({ _id: shift._id, name: shift.name, start: shift.start, end: shift.end })),
    seats: seats.map((seat) => ({ _id: seat._id, label: seat.label, floor: seat.floor, availableNow: !occupied.has(String(seat._id)) })),
    availabilityCalculatedAt: now,
  };
}

export async function GET(request: NextRequest) {
  const location = request.nextUrl.searchParams.get("location")?.trim().slice(0, 80) || "";
  const facility = request.nextUrl.searchParams.get("facility")?.trim() || "";
  const maxFee = Math.max(0, Number(request.nextUrl.searchParams.get("maxFee") || 0));
  const slug = request.nextUrl.searchParams.get("slug")?.trim();
  const page = Math.max(1, Number(request.nextUrl.searchParams.get("page") || 1));
  const query: Record<string, unknown> = { listingVisible: true };
  if (slug) query.publicSlug = slug;
  if (location) query.$or = [{ city: new RegExp(escapeRegex(location), "i") }, { address: new RegExp(escapeRegex(location), "i") }, { name: new RegExp(escapeRegex(location), "i") }];
  if (facility) query.facilities = facility;
  const libraries = await Library.find(query).sort({ name: 1 }).skip(slug ? 0 : (page - 1) * 12).limit(slug ? 1 : 12).lean();
  const enriched = await Promise.all(libraries.map((library) => publicLibrary(library as unknown as Record<string, unknown>)));
  const filtered = maxFee ? enriched.filter((library) => library.feeFrom !== null && Number(library.feeFrom) <= maxFee) : enriched;
  const user = await currentUser();
  if (user?.role === "student") await expireStaleOffers({ userId: user._id });
  if (user?.libraryId && ["owner", "staff"].includes(user.role)) await expireStaleOffers({ libraryId: user.libraryId });
  const requests = user?.role === "student" ? await Promise.all([
    LibraryVisitRequest.find({ userId: user._id }).sort({ createdAt: -1 }).limit(30).lean(),
    SeatWaitlist.find({ userId: user._id }).sort({ createdAt: -1 }).limit(30).lean(),
  ]) : [[], []];
  const management = user?.libraryId && ["owner", "staff"].includes(user.role) ? await Promise.all([
    Library.findById(user.libraryId).lean(),
    SeatWaitlist.find({ libraryId: user.libraryId, status: { $in: ["waiting", "offered", "accepted"] } }).sort({ createdAt: 1 }).limit(100).lean(),
    LibraryVisitRequest.find({ libraryId: user.libraryId, status: { $in: ["pending", "approved"] } }).sort({ preferredAt: 1 }).limit(100).lean(),
    Seat.find({ libraryId: user.libraryId, operationalStatus: { $ne: "maintenance" } }).sort({ label: 1 }).limit(500).lean(),
  ]) : [null, [], [], []];
  return NextResponse.json({ libraries: filtered, detail: slug ? filtered[0] || null : null, page, visits: requests[0], waitlist: requests[1], management: { library: management[0], waitlist: management[1], visits: management[2], seats: management[3] } });
}

export async function POST(request: NextRequest) {
  if (!validOrigin(request)) return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  if (limited(`discovery:${user._id}`, 30)) return NextResponse.json({ error: "Please slow down" }, { status: 429 });
  try {
    const body = z.object({ action: z.enum(["listing-save", "visit-request", "waitlist-join", "waitlist-cancel", "waitlist-offer", "waitlist-accept", "waitlist-confirm", "visit-status", "visit-cancel"]), data: z.unknown() }).parse(await request.json());
    let record: unknown;
    await expireStaleOffers(user.role === "student" ? { userId: user._id } : user.libraryId ? { libraryId: user.libraryId } : { _id: null });
    if (body.action === "listing-save") {
      if (user.role !== "owner" || !user.libraryId) throw new Error("Owner access required");
      const value = z.object({ publicSlug: z.string().trim().toLowerCase().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).min(3).max(60), listingVisible: z.boolean(), city: z.string().trim().min(2).max(80), publicDescription: z.string().trim().max(700), facilities: z.array(z.enum(["wifi", "air-conditioning", "power-backup", "lockers", "drinking-water", "quiet-zone", "accessible-entry"])).max(7) }).parse(body.data);
      record = await Library.findOneAndUpdate({ _id: user.libraryId, ownerId: user._id }, value, { new: true, runValidators: true });
    } else if (body.action === "visit-request") {
      if (user.role !== "student") throw new Error("Student access required");
      const value = z.object({ libraryId: objectId, preferredAt: z.iso.datetime(), message: z.string().trim().max(300).default("") }).parse(body.data);
      if (new Date(value.preferredAt) < new Date()) throw new Error("Choose a future visit time");
      if (!await Library.exists({ _id: value.libraryId, listingVisible: true })) throw new Error("Library listing not found");
      if (await LibraryVisitRequest.exists({ libraryId: value.libraryId, userId: user._id, status: { $in: ["pending", "approved"] } })) throw new Error("You already have an active visit request");
      record = await LibraryVisitRequest.create({ ...value, userId: user._id });
    } else if (body.action === "waitlist-join") {
      if (user.role !== "student") throw new Error("Student access required");
      const value = z.object({ libraryId: objectId, preferredSeatId: objectId.optional(), shiftId: objectId, planId: objectId }).parse(body.data);
      const [library, shift, plan, seat] = await Promise.all([
        Library.exists({ _id: value.libraryId, listingVisible: true }), Shift.exists({ _id: value.shiftId, libraryId: value.libraryId }),
        MembershipPlan.exists({ _id: value.planId, libraryId: value.libraryId }), value.preferredSeatId ? Seat.exists({ _id: value.preferredSeatId, libraryId: value.libraryId, operationalStatus: { $ne: "maintenance" } }) : true,
      ]);
      if (!library || !shift || !plan || !seat) throw new Error("Invalid waitlist preference");
      if (await SeatWaitlist.exists({ libraryId: value.libraryId, userId: user._id, shiftId: value.shiftId, planId: value.planId, status: { $in: ["waiting", "offered", "accepted", "confirmed"] } })) throw new Error("You are already in this queue");
      record = await SeatWaitlist.create({ ...value, userId: user._id });
    } else if (body.action === "waitlist-cancel") {
      const value = z.object({ id: objectId }).parse(body.data);
      record = await SeatWaitlist.findOneAndUpdate({ _id: value.id, userId: user._id, status: { $in: ["waiting", "offered", "accepted"] } }, { status: "cancelled" }, { new: true });
      if (!record) throw new Error("Active waitlist entry not found");
    } else if (body.action === "waitlist-accept") {
      const value = z.object({ id: objectId }).parse(body.data);
      record = await SeatWaitlist.findOneAndUpdate({ _id: value.id, userId: user._id, status: "offered", offerExpiresAt: { $gt: new Date() } }, { status: "accepted", acceptedAt: new Date() }, { new: true });
      if (!record) throw new Error("Offer is unavailable or expired");
    } else if (body.action === "visit-cancel") {
      const value = z.object({ id: objectId }).parse(body.data);
      record = await LibraryVisitRequest.findOneAndUpdate({ _id: value.id, userId: user._id, status: { $in: ["pending", "approved"] } }, { status: "cancelled" }, { new: true });
      if (!record) throw new Error("Active visit request not found");
    } else if (body.action === "visit-status") {
      if (!["owner", "staff"].includes(user.role) || !user.libraryId) throw new Error("Library team access required");
      const value = z.object({ id: objectId, status: z.enum(["approved", "declined", "visited"]) }).parse(body.data);
      record = await LibraryVisitRequest.findOneAndUpdate({ _id: value.id, libraryId: user.libraryId, status: { $in: ["pending", "approved"] } }, { status: value.status }, { new: true });
      if (!record) throw new Error("Visit request not found");
    } else {
      if (!["owner", "staff"].includes(user.role) || !user.libraryId) throw new Error("Library team access required");
      if (body.action === "waitlist-offer") {
        const value = z.object({ id: objectId, seatId: objectId }).parse(body.data);
        const entry = await SeatWaitlist.findOne({ _id: value.id, libraryId: user.libraryId, status: "waiting" });
        if (!entry) throw new Error("Waiting student not found");
        const [seat, shift, plan] = await Promise.all([Seat.findOne({ _id: value.seatId, libraryId: user.libraryId, operationalStatus: { $ne: "maintenance" } }), Shift.findById(entry.shiftId), MembershipPlan.findById(entry.planId)]);
        if (!seat || !shift || !plan) throw new Error("Seat, shift or plan unavailable");
        const start = new Date(), end = new Date(start.getTime() + plan.days * 86400000);
        const conflict = await SeatAssignment.exists({ libraryId: user.libraryId, seatId: seat._id, start: { $lt: end }, end: { $gt: start }, shiftStart: { $lt: shift.end }, shiftEnd: { $gt: shift.start } });
        if (conflict) throw new Error("Seat is assigned for this shift");
        if (await SeatWaitlist.exists({ libraryId: user.libraryId, offeredSeatId: seat._id, shiftId: entry.shiftId, status: { $in: ["offered", "accepted"] } })) throw new Error("This seat already has an active offer for this shift");
        const expires = offerExpiry(new Date());
        record = await SeatWaitlist.findOneAndUpdate({ _id: entry._id, status: "waiting" }, { status: "offered", offeredSeatId: seat._id, offeredAt: new Date(), offerExpiresAt: expires }, { new: true });
        await Notification.create({ libraryId: user.libraryId, userId: entry.userId, title: "Seat offer available", message: `Seat ${seat.label} is reserved for 24 hours. Accept it from your waitlist.` });
      } else {
        const value = z.object({ id: objectId }).parse(body.data);
        record = await SeatWaitlist.findOneAndUpdate({ _id: value.id, libraryId: user.libraryId, status: "accepted", offerExpiresAt: { $gt: new Date() } }, { status: "confirmed", confirmedAt: new Date() }, { new: true });
        if (!record) throw new Error("Accepted offer not found");
      }
    }
    return NextResponse.json({ ok: true, record });
  } catch (error) {
    return NextResponse.json({ error: error instanceof z.ZodError ? error.issues[0]?.message || "Check all fields" : error instanceof Error ? error.message : "Unable to update discovery" }, { status: error instanceof z.ZodError ? 422 : 400 });
  }
}
