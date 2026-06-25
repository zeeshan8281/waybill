/**
 * External model adapter — OpenAI-compatible (Sakana Fugu or OpenRouter).
 *
 * Fugu is itself a multi-agent orchestrator served as one OpenAI-compatible API.
 * We hit the Chat Completions endpoint of whichever provider is configured:
 *   - SAKANA_API_KEY  → https://api.sakana.ai/v1   (native; fugu + fugu-ultra)
 *   - OPENROUTER_API_KEY → https://openrouter.ai/api/v1 (serves sakana/fugu-ultra)
 *
 * The receipt's chosen_model records the ROUTER's decision (fugu | fugu-ultra);
 * MODEL_MAP translates that to the provider's model id at call time. OpenRouter
 * only serves Ultra, so both tiers map to sakana/fugu-ultra there.
 *
 * Inference happens OUTSIDE the enclave boundary — the receipt is honest about
 * "the router asked for model X and received a response hashing to H", not that
 * X definitely produced H. See README trust model.
 *
 * ponytail: provider picked from whichever key is set; mock when neither is.
 */
import { createHash } from "node:crypto";

const OPENROUTER = Boolean(process.env.OPENROUTER_API_KEY) && !process.env.SAKANA_API_KEY;
const API_KEY = process.env.OPENROUTER_API_KEY || process.env.SAKANA_API_KEY || "";
const BASE_URL = (
  process.env.FUGU_API_URL ||
  (OPENROUTER ? "https://openrouter.ai/api/v1" : "https://api.sakana.ai/v1")
).replace(/\/+$/, "");

// Router model id -> provider model id. Override with FUGU_MODEL_MAP (JSON).
const MODEL_MAP: Record<string, string> = process.env.FUGU_MODEL_MAP
  ? JSON.parse(process.env.FUGU_MODEL_MAP)
  : OPENROUTER
    ? { fugu: "sakana/fugu-ultra", "fugu-ultra": "sakana/fugu-ultra" }
    : {};

/** Send prompt to the chosen Fugu model, return the response text. */
export async function callModel(model: string, prompt: string): Promise<string> {
  if (!API_KEY) {
    // mock: deterministic so tests/demos are reproducible offline.
    const digest = createHash("sha256").update(`${model}:${prompt}`).digest("hex").slice(0, 12);
    return `[mock ${model}] response to prompt (${digest})`;
  }

  const resp = await fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      "content-type": "application/json",
      // OpenRouter attribution (optional, recommended).
      ...(OPENROUTER
        ? { "HTTP-Referer": "https://github.com/zeeshan8281/waybill", "X-Title": "Waybill" }
        : {}),
    },
    body: JSON.stringify({ model: MODEL_MAP[model] ?? model, messages: [{ role: "user", content: prompt }] }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!resp.ok) throw new Error(`Fugu ${resp.status}: ${await resp.text()}`);
  const data: any = await resp.json();
  return data.choices[0].message.content;
}
