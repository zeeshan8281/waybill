/**
 * Routing receipts: canonical hashing, hash-chaining, and signing.
 *
 * A receipt is signed inside the enclave by the enclave-bound key. Each receipt
 * carries prev_hash + monotonic seq, so suppression/reordering/replay are
 * detectable once the chain root (or every receipt, in this build) is anchored.
 */
import { createHash } from "node:crypto";

import * as policy from "./policy.js";
import * as signer from "./signer.js";

export const ZERO_HASH = "0".repeat(64);

// Fields added after hashing — not part of the signed body.
const META = new Set(["signature", "hash", "signer", "anchor_tx"]);

export type Receipt = Record<string, unknown> & { hash: string; signature: string };

export function sha256Hex(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

/**
 * Deterministic JSON for hashing/signing (recursively sorted keys, no
 * whitespace) — matches Python json.dumps(sort_keys=True, separators=(",",":")).
 */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const o = value as Record<string, unknown>;
    const body = Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`)
      .join(",");
    return `{${body}}`;
  }
  return JSON.stringify(value);
}

/** Hash of the unsigned receipt body (meta fields excluded). */
export function receiptHash(receipt: Record<string, unknown>): string {
  const body: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(receipt)) if (!META.has(k)) body[k] = v;
  return sha256Hex(canonical(body));
}

/** Assemble + sign a receipt. Returns the receipt incl. signature + its hash. */
export async function build(args: {
  taskId: string;
  prompt: string;
  chosenModel: string;
  response: string;
  imageDigest: string;
  prevHash: string;
  seq: number;
}): Promise<Receipt> {
  const receipt: Record<string, unknown> = {
    task_id: args.taskId,
    input_hash: sha256Hex(args.prompt),
    candidates: policy.CANDIDATES,
    chosen_model: args.chosenModel,
    policy_hash: policy.POLICY_HASH,
    response_hash: sha256Hex(args.response),
    image_digest: args.imageDigest,
    prev_hash: args.prevHash,
    seq: args.seq,
  };
  const h = receiptHash(receipt);
  receipt.signature = await signer.sign(h);
  receipt.hash = h;
  // Convenience for verifiers; the authoritative signer address is the one
  // recorded on-chain (AppController) / shown on the verify dashboard.
  receipt.signer = signer.address();
  return receipt as Receipt;
}
