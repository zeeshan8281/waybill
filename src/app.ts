/**
 * Waybill orchestrator — runs inside the TDX enclave on EigenCompute.
 *
 * POST /route {prompt}  -> chooses a model, calls it, signs + anchors a receipt,
 *                          returns the answer with its verifiable receipt.
 * GET  /chain           -> the hash-chained receipt log (this run).
 * GET  /healthz         -> liveness + signer address + image digest.
 *
 * ponytail: in-memory chain state, single process. Persist (or read prev_hash
 * from the last anchored tx) if you run multiple instances.
 */
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import express from "express";

import * as adapters from "./adapters.js";
import * as anchor from "./anchor.js";
import { readAttestation } from "./attestation.js";
import * as policy from "./policy.js";
import * as receiptMod from "./receipt.js";
import * as signer from "./signer.js";

const IMAGE_DIGEST = process.env.IMAGE_DIGEST ?? "unknown";
const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "public");

const app = express();
app.use(express.json());
app.use(express.static(PUBLIC_DIR)); // serves the UI at /

// Hash-chain state for this run.
const chain: receiptMod.Receipt[] = [];

app.get("/healthz", (_req, res) => {
  res.json({
    ok: true,
    signer: signer.address(),
    image_digest: IMAGE_DIGEST,
    policy_hash: policy.POLICY_HASH,
    anchoring: anchor.enabled(),
    receipts: chain.length,
  });
});

app.get("/chain", (_req, res) => {
  res.json({ signer: signer.address(), receipts: chain });
});

app.get("/verify", (_req, res) => {
  res.json({
    signer: signer.address(),
    policy_hash: policy.POLICY_HASH,
    anchoring: anchor.enabled(),
    attestation: readAttestation(),
  });
});

app.post("/route", async (req, res) => {
  const prompt: string = req.body?.prompt;
  if (typeof prompt !== "string") {
    res.status(422).json({ error: "prompt (string) is required" });
    return;
  }

  const chosen = policy.route(prompt);
  const response = await adapters.callModel(chosen, prompt);

  const prevHash = chain.length ? chain[chain.length - 1].hash : receiptMod.ZERO_HASH;
  const rcpt = await receiptMod.build({
    taskId: randomUUID(),
    prompt,
    chosenModel: chosen,
    response,
    imageDigest: IMAGE_DIGEST,
    prevHash,
    seq: chain.length,
  });
  rcpt.anchor_tx = await anchor.anchor(rcpt.hash);
  chain.push(rcpt);

  res.json({ answer: response, receipt: rcpt });
});

const PORT = Number(process.env.PORT ?? 8080);
// Must bind 0.0.0.0 (not localhost) for the TEE.
app.listen(PORT, "0.0.0.0", () => console.log(`waybill listening on :${PORT}`));

export { app };
