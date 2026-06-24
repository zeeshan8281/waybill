/**
 * Minimal declarative routing policy.
 *
 * The policy is plain data: an ordered list of (predicate, model) rules. The
 * first matching rule wins; the last rule is the catch-all default. POLICY_HASH
 * is the sha256 of THIS file's source, so a receipt pins exactly which routing
 * logic ran.
 *
 * ponytail: rules-as-data, not a DSL. Bring-your-own policy = replace RULES +
 * route(). Swap in a classifier later if keyword matching measurably falls short.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Real Sakana Fugu model ids (https://api.sakana.ai/v1, /v1/models). Fugu exposes
// two tiers: `fugu` (balanced, low latency) and `fugu-ultra` (max quality). The
// router escalates code/long tasks to Ultra, everything else stays on base Fugu.
export const FUGU = "fugu";
export const ULTRA = "fugu-ultra";

const CODE_RE = /\b(code|bug|function|stack ?trace|refactor|compile|regex|api|sql)\b/i;

const isCode = (prompt: string): boolean => CODE_RE.test(prompt);
const isLong = (prompt: string): boolean => prompt.length > 2000;

// Ordered rules: [predicate, model]. First match wins.
const RULES: ReadonlyArray<[(p: string) => boolean, string]> = [
  [isCode, ULTRA],
  [isLong, ULTRA],
  [() => true, FUGU], // default
];

export const CANDIDATES = [FUGU, ULTRA];

// sha256 of this source file — the on-the-wire identity of the routing logic.
export const POLICY_HASH = createHash("sha256")
  .update(readFileSync(fileURLToPath(import.meta.url)))
  .digest("hex");

/** Return the chosen model id for a prompt. */
export function route(prompt: string): string {
  for (const [predicate, model] of RULES) {
    if (predicate(prompt)) return model;
  }
  return FUGU; // unreachable; keeps type checkers happy
}
