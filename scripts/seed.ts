import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import { db } from "../src/lib/db";
import {
  User,
  Library,
  Seat,
  Shift,
  MembershipPlan,
  StudentProfile,
  ExamCatalog,
  SyllabusNode,
} from "../src/lib/models";
async function main() {
  if (process.env.NODE_ENV === "production")
    throw new Error("Seed is disabled in production");
  const email = process.env.SEED_EMAIL,
    password = process.env.SEED_PASSWORD;
  if (!email || !password || password.length < 10)
    throw new Error(
      "Set SEED_EMAIL and SEED_PASSWORD (10+ characters). Run with node --env-file=.env.local --import tsx scripts/seed.ts",
    );
  await db();
  if (await User.exists({ email }))
    throw new Error("Seed email already exists; nothing was changed");
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const [owner] = await User.create(
        [
          {
            name: "The Reading Room",
            email,
            passwordHash: await bcrypt.hash(password, 12),
            role: "owner",
          },
        ],
        { session },
      );
      const [library] = await Library.create(
        [
          {
            name: "The Reading Room",
            ownerId: owner._id,
            address: "Fictional demo library",
          },
        ],
        { session },
      );
      owner.libraryId = library._id;
      await owner.save({ session });
      await Seat.create(
        Array.from({ length: 60 }, (_, i) => ({
          libraryId: library._id,
          label: `A-${String(i + 1).padStart(2, "0")}`,
          floor: i < 30 ? "Ground floor" : "First floor",
        })),
        { session },
      );
      await Shift.create(
        [
          { libraryId: library._id, name: "Morning", start: 360, end: 840 },
          { libraryId: library._id, name: "Evening", start: 840, end: 1320 },
        ],
        { session },
      );
      await MembershipPlan.create(
        [
          {
            libraryId: library._id,
            name: "Monthly focus",
            amount: 150000,
            days: 30,
          },
          {
            libraryId: library._id,
            name: "Weekly focus",
            amount: 50000,
            days: 7,
          },
        ],
        { session },
      );
      const [student] = await User.create(
        [
          {
            name: "Alex Morgan",
            email: `student+${email}`,
            passwordHash: await bcrypt.hash(password, 12),
            role: "student",
            libraryId: library._id,
          },
        ],
        { session },
      );
      await StudentProfile.create(
        [
          {
            userId: student._id,
            libraryId: library._id,
            exam: "Civil services",
            goalMinutes: 120,
          },
        ],
        { session },
      );
      await ExamCatalog.create(
        [
          { key: "ssc", title: "SSC", description: "Staff Selection Commission examinations" },
          { key: "banking", title: "Banking", description: "IBPS, SBI and related banking examinations" },
          { key: "railway", title: "Railway", description: "Railway recruitment examinations" },
          { key: "upsc", title: "UPSC", description: "Civil services preparation" },
          { key: "neet", title: "NEET", description: "Medical entrance preparation" },
        ],
        { session },
      );
      const [generalStudies, environment] = await SyllabusNode.create(
        [
          { examKey: "upsc", type: "subject", title: "General Studies", order: 1, estimatedMinutes: 600 },
          { examKey: "upsc", type: "subject", title: "Environment", order: 2, estimatedMinutes: 420 },
        ],
        { session },
      );
      const [polity, ecology] = await SyllabusNode.create(
        [
          { examKey: "upsc", parentId: generalStudies._id, type: "chapter", title: "Indian Polity", order: 1, estimatedMinutes: 300 },
          { examKey: "upsc", parentId: environment._id, type: "chapter", title: "Ecology", order: 1, estimatedMinutes: 220 },
        ],
        { session },
      );
      await SyllabusNode.create(
        [
          { examKey: "upsc", parentId: polity._id, type: "topic", title: "Fundamental Rights", order: 1, estimatedMinutes: 90 },
          { examKey: "upsc", parentId: polity._id, type: "topic", title: "Parliament", order: 2, estimatedMinutes: 120 },
          { examKey: "upsc", parentId: ecology._id, type: "topic", title: "Biodiversity", order: 1, estimatedMinutes: 80 },
        ],
        { session },
      );
    });
    console.log(
      "Local fictional library seeded. Sign in with the SEED_EMAIL you supplied.",
    );
  } finally {
    await session.endSession();
    await mongoose.disconnect();
  }
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
