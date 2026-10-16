import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { solveDoubt, validateImageData } from "../src/lib/ai-provider";

describe("AI doubt provider", () => {
  it("returns transparent deterministic guidance when no provider is configured", async () => {
    delete process.env.STUDYQUEST_AI_PROVIDER;
    const answer = await solveDoubt({ question: "Why is acceleration constant in free fall?", subject: "Physics", difficulty: "standard" });
    assert.equal(answer.provider, "fallback");
    assert.ok(answer.steps.length >= 3);
    assert.match(answer.answer, /unavailable/i);
    assert.match(answer.disclaimer, /Verify/i);
  });

  it("validates image magic bytes and rejects disguised uploads", () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    assert.equal(validateImageData(`data:image/png;base64,${png.toString("base64")}`)?.mime, "image/png");
    assert.throws(() => validateImageData(`data:image/png;base64,${Buffer.from("not an image").toString("base64")}`), /does not match/);
    assert.throws(() => validateImageData("data:text/plain;base64,SGVsbG8="), /PNG, JPEG, or WebP/);
  });
});
