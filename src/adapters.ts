/**
 * External model adapter — Sakana Fugu (OpenAI-compatible).
 *
 * Fugu is itself a multi-agent orchestrator served as one OpenAI-compatible API
 * (https://api.sakana.ai/v1). We hit the Chat Completions endpoint. Inference
 * happens OUTSIDE the enclave boundary, so the receipt is honest about "the
 * router asked for model X and received a response hashing to H" — not that X
 * definitely produced H. See README trust model.
 *
 * ponytail: if SAKANA_API_KEY is unset we run in mock mode so the demo works
 * without a key. Set the key (sealed secret on EigenCompute) to route for real.
 */
import { createHash } from "node:crypto";

const FUGU_API_URL = (process.env.FUGU_API_URL || "https://api.sakana.ai/v1").replace(/\/+$/, "");
const SAKANA_API_KEY = process.env.SAKANA_API_KEY ?? "";

/** Send prompt to the chosen Fugu model, return the response text. */
export async function callModel(model: string, prompt: string): Promise<string> {
  if (!SAKANA_API_KEY) {
    // mock: deterministic so tests/demos are reproducible offline.
    const digest = createHash("sha256").update(`${model}:${prompt}`).digest("hex").slice(0, 12);
    return `[mock ${model}] response to prompt (${digest})`;
  }

  const resp = await fetch(`${FUGU_API_URL}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SAKANA_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ model, messages: [{ role: "user", content: prompt }] }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!resp.ok) throw new Error(`Fugu ${resp.status}: ${await resp.text()}`);
  const data: any = await resp.json();
  return data.choices[0].message.content;
}
