/**
 * One runnable self-check for the money/security paths: hashing, chaining,
 * sign/recover roundtrip, tamper detection, policy routing.
 *
 *   npm test
 */
// throwaway key so the check runs with no setup
process.env.WAYBILL_SIGNER_KEY ??=
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";

import assert from "node:assert/strict";
import { test } from "node:test";

import * as policy from "../src/policy.js";
import * as rcptMod from "../src/receipt.js";
import * as signer from "../src/signer.js";

const build = (prompt = "hello", response = "world", prev = rcptMod.ZERO_HASH, seq = 0) =>
  rcptMod.build({
    taskId: "t1",
    prompt,
    chosenModel: policy.route(prompt),
    response,
    imageDigest: "img@sha256:deadbeef",
    prevHash: prev,
    seq,
  });

test("hash and signature roundtrip", async () => {
  const r = await build();
  assert.equal(rcptMod.receiptHash(r), r.hash, "hash must recompute from body");
  assert.equal(signer.recover(r.hash, r.signature).toLowerCase(), (r.signer as string).toLowerCase());
});

test("input and response hashes match", async () => {
  const r = await build("the prompt", "the answer");
  assert.equal(r.input_hash, rcptMod.sha256Hex("the prompt"));
  assert.equal(r.response_hash, rcptMod.sha256Hex("the answer"));
});

test("tamper is detected", async () => {
  const r = await build();
  r.chosen_model = "fugu-evil"; // forge the routing decision
  assert.notEqual(rcptMod.receiptHash(r), r.hash, "tampered body must change hash");
});

test("chain links", async () => {
  const r0 = await build("first", "world", rcptMod.ZERO_HASH, 0);
  const r1 = await build("second", "world", r0.hash, 1);
  assert.equal(r1.prev_hash, r0.hash);
  assert.deepEqual([r0.seq, r1.seq], [0, 1]);
});

test("policy routes distinctly", () => {
  assert.equal(policy.route("fix this bug in my function"), policy.ULTRA); // code → ultra
  assert.equal(policy.route("x".repeat(3000)), policy.ULTRA); // long → ultra
  assert.equal(policy.route("hello there"), policy.FUGU); // default → base fugu
  assert.equal(policy.POLICY_HASH.length, 64);
});
