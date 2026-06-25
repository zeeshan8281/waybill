import { verifyMessage, getBytes } from "ethers";

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

export async function sha256Hex(str: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
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
