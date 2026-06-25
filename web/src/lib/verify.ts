import { verifyMessage, getBytes, sha256, toUtf8Bytes, hashMessage } from "ethers";

/**
 * The exact 32-byte digest that was ECDSA-signed (EIP-191 prefix applied to the
 * receipt hash bytes). Paste this into the EigenCloud "Verify a Signature" tool
 * with "Data is pre-hashed" checked — it recovers the signer with no ambiguity.
 */
export function verifyDigest(receiptHash: string): string {
  return hashMessage(getBytes("0x" + receiptHash));
}

export interface Receipt {
  task_id: string;
  input_hash: string;
  candidates: string[];
  chosen_model: string;
  policy_hash: string;
  response_hash: string;
  image_digest: string;
  prev_hash: string;
  seq: number;
  signature: string;
  hash: string;
  signer: string;
  anchor_tx: string | null;
  steps?: Array<{ seq: number; role: string; model: string; input_hash: string; output_hash: string }>;
}

export interface Attestation {
  app_id: string;
  image_digest: string;
  build_time: string;
  attestation_hash: string;
  verify_url: string | null;
  source: "tee" | "local-dev";
  key_source: "kms-mnemonic" | "local-key";
}

const META = new Set(["signature", "hash", "signer", "anchor_tx"]);

// Canonical JSON identical to the server (recursively sorted keys, tight separators).
function canonical(v: unknown): string {
  if (Array.isArray(v)) return "[" + v.map(canonical).join(",") + "]";
  if (v !== null && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return (
      "{" +
      Object.keys(o)
        .sort()
        .map((k) => JSON.stringify(k) + ":" + canonical(o[k]))
        .join(",") +
      "}"
    );
  }
  return JSON.stringify(v);
}

// Uses ethers' pure-JS sha256 (not WebCrypto's crypto.subtle) so verification
// works in non-secure contexts too — e.g. the TEE served over plain http.
export async function sha256Hex(str: string): Promise<string> {
  return sha256(toUtf8Bytes(str)).slice(2); // strip 0x
}

async function receiptHash(r: Record<string, unknown>): Promise<string> {
  const body: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(r)) if (!META.has(k)) body[k] = val;
  return sha256Hex(canonical(body));
}

export interface VerifyResult {
  hashOk: boolean;
  sigOk: boolean;
  recovered: string;
  inputOk: boolean;
  respOk: boolean;
}

/** Re-verify a receipt entirely in the browser — trust no one. */
export async function verifyReceipt(
  r: Receipt,
  prompt: string,
  answer: string,
): Promise<VerifyResult> {
  const hashOk = (await receiptHash(r as unknown as Record<string, unknown>)) === r.hash;
  let recovered = "";
  let sigOk = false;
  try {
    recovered = verifyMessage(getBytes("0x" + r.hash), r.signature);
    sigOk = recovered.toLowerCase() === (r.signer || "").toLowerCase();
  } catch {
    /* malformed signature → sigOk stays false */
  }
  const inputOk = (await sha256Hex(prompt)) === r.input_hash;
  const respOk = (await sha256Hex(answer)) === r.response_hash;
  return { hashOk, sigOk, recovered, inputOk, respOk };
}

export const short = (s: string | null | undefined, n = 10): string =>
  s ? s.slice(0, n) + "…" : "—";
