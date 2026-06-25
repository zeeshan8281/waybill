/**
 * Minimal declarative routing policy.
 *
 * The policy is plain data: an ordered list of (predicate, model) rules. The
 * first matching rule wins. POLICY_HASH is the sha256 of THIS file's source, so
 * a receipt pins exactly which routing logic ran — change the pool or the rules
 * and every verifier sees a different policy_hash.
 *
 * v1 pool: a single real Sakana Fugu tier, `fugu-ultra` (https://api.sakana.ai/v1,
 * also OpenRouter sakana/fugu-ultra). The base `fugu` tier is intentionally out
 * of the pool. Add a model to CANDIDATES + a rule and the routing decision
 * becomes non-trivial — that's the extension point the receipt makes verifiable.
 *
 * ponytail: rules-as-data, not a DSL. Swap in a classifier later if needed.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// The only model the router can pick today. Fugu Ultra is itself a multi-agent
// orchestrator across frontier models — Waybill attests which tier it chose.
export const ULTRA = "fugu-ultra";

// Ordered rules: [predicate, model]. First match wins. One model ⇒ one rule.
const RULES: ReadonlyArray<[(p: string) => boolean, string]> = [[() => true, ULTRA]];

export const CANDIDATES = [ULTRA];

// sha256 of this source file — the on-the-wire identity of the routing logic.
export const POLICY_HASH = createHash("sha256")
  .update(readFileSync(fileURLToPath(import.meta.url)))
  .digest("hex");

/** Return the chosen model id for a prompt. */
export function route(prompt: string): string {
  for (const [predicate, model] of RULES) {
    if (predicate(prompt)) return model;
  }
  return ULTRA; // unreachable; keeps type checkers happy
}
