import { MongoMemoryReplSet } from "mongodb-memory-server";
import { spawn } from "node:child_process";
async function main() {
  const replica = await MongoMemoryReplSet.create({
    replSet: { count: 1 },
    binary: { version: "7.0.14" },
  });
  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(
        process.execPath,
        ["--import", "tsx", "--test", "tests/integration.test.ts", "tests/backup.integration.test.ts"],
        {
          stdio: "inherit",
          env: { ...process.env, TEST_MONGODB_URI: replica.getUri() },
        },
      );
      child.on("error", reject);
      child.on("exit", (code) =>
        code === 0
          ? resolve()
          : reject(new Error(`Integration tests exited ${code}`)),
      );
    });
  } finally {
    await replica.stop();
  }
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
