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
import "./env.js"; // load .env BEFORE any module reads process.env (must be first)

import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import express from "express";

import * as adapters from "./adapters.js";
import * as anchor from "./anchor.js";
import { readAttestation } from "./attestation.js";
import * as policy from "./policy.js";
import { runPipeline } from "./pipeline.js";
import * as receiptMod from "./receipt.js";
import * as signer from "./signer.js";

const IMAGE_DIGEST = process.env.IMAGE_DIGEST ?? "unknown";
const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "public");

// Last-resort safety net: a stray async error must never take down the TEE VM.
process.on("unhandledRejection", (e) => console.error("unhandledRejection:", e));
process.on("uncaughtException", (e) => console.error("uncaughtException:", e));

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

  try {
    const chosen = policy.route(prompt);

    // Conduct the multi-step pipeline (draft → critique → revise) in the enclave.
    const { steps, answer } = await runPipeline(chosen, prompt);
    const receiptSteps = steps.map((s) => ({
      seq: s.seq,
      role: s.role,
      model: s.model,
      input_hash: receiptMod.sha256Hex(s.input),
      output_hash: receiptMod.sha256Hex(s.output),
    }));

    const prevHash = chain.length ? chain[chain.length - 1].hash : receiptMod.ZERO_HASH;
    const rcpt = await receiptMod.build({
      taskId: randomUUID(),
      prompt,
      chosenModel: chosen,
      response: answer,
      imageDigest: IMAGE_DIGEST,
      prevHash,
      seq: chain.length,
      steps: receiptSteps,
    });
    rcpt.anchor_tx = await anchor.anchor(rcpt.hash);
    chain.push(rcpt);

    // Step outputs are returned for display (not in the signed body) — the UI
    // re-checks each output_hash in the browser.
    res.json({
      answer,
      receipt: rcpt,
      steps: steps.map((s) => ({ seq: s.seq, role: s.role, model: s.model, output: s.output })),
    });
  } catch (e) {
    // A provider/model error must never crash the enclave. Return it, stay up.
    console.error("route failed:", e);
    res.status(502).json({ error: "model call failed", detail: (e as Error).message });
  }
});

// Streaming variant — emits the orchestration as it happens (NDJSON), so the UI
// can show each pipeline step land live instead of waiting on the whole run.
app.post("/route/stream", async (req, res) => {
  const prompt: string = req.body?.prompt;
  if (typeof prompt !== "string") {
    res.status(422).json({ error: "prompt (string) is required" });
    return;
  }
  res.setHeader("content-type", "application/x-ndjson");
  res.setHeader("cache-control", "no-cache, no-transform");
  res.setHeader("x-accel-buffering", "no"); // ask proxies not to buffer
  res.flushHeaders();
  const send = (o: unknown) => res.write(JSON.stringify(o) + "\n");

  try {
    const taskId = randomUUID();
    const chosen = policy.route(prompt);
    send({ id: "input", label: "Hash task input", detail: `input_hash ${receiptMod.sha256Hex(prompt).slice(0, 18)}…` });
    send({ id: "policy", label: "Evaluate routing policy", detail: `candidates [${policy.CANDIDATES.join(", ")}]` });
    send({ id: "route", label: `Route → ${chosen}`, detail: `chosen_model = ${chosen}` });

    const { steps, answer } = await runPipeline(chosen, prompt, {
      onStepStart: (seq, role) => { send({ pstep: true, seq, role, state: "active" }); },
      onStepDone: (s) => {
        send({ pstep: true, seq: s.seq, role: s.role, state: "done", output: s.output, output_hash: receiptMod.sha256Hex(s.output) });
      },
    });

    const receiptSteps = steps.map((s) => ({
      seq: s.seq,
      role: s.role,
      model: s.model,
      input_hash: receiptMod.sha256Hex(s.input),
      output_hash: receiptMod.sha256Hex(s.output),
    }));
    const prevHash = chain.length ? chain[chain.length - 1].hash : receiptMod.ZERO_HASH;
    const rcpt = await receiptMod.build({
      taskId,
      prompt,
      chosenModel: chosen,
      response: answer,
      imageDigest: IMAGE_DIGEST,
      prevHash,
      seq: chain.length,
      steps: receiptSteps,
    });
    send({ id: "sign", label: "Sign receipt · KMS enclave wallet", detail: `signer ${(rcpt.signer as string).slice(0, 16)}…` });
    rcpt.anchor_tx = await anchor.anchor(rcpt.hash);
    chain.push(rcpt);
    send({ id: "chain", label: "Chain receipt", detail: `seq ${rcpt.seq}` });

    send({ done: true, answer, receipt: rcpt });
  } catch (e) {
    console.error("route/stream failed:", e);
    send({ error: (e as Error).message });
  } finally {
    res.end();
  }
});

const PORT = Number(process.env.PORT ?? 8080);
// Must bind 0.0.0.0 (not localhost) for the TEE.
app.listen(PORT, "0.0.0.0", () => console.log(`waybill listening on :${PORT}`));

export { app };
