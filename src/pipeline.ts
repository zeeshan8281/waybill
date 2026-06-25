/**
 * Multi-step orchestration pipeline.
 *
 * Waybill conducts a draft → critique → revise pipeline, each a real Fugu call
 * inside the enclave. The steps hash-chain by content (step N's input embeds
 * step N-1's output), and the whole lineage is signed into the receipt — so a
 * verifier sees exactly which steps the conductor ran, in order, tamper-evident.
 *
 * This is the orchestration Waybill itself performs and verifies (distinct from
 * Fugu Ultra's own internal, opaque orchestration of frontier models).
 *
 * ponytail: roles are prompt prefixes, not a framework. Add/remove a ROLE to
 * change the pipeline.
 */
import { callModel } from "./adapters.js";

export interface PipelineStep {
  seq: number;
  role: string;
  model: string;
  input: string;
  output: string;
}

const ROLES = [
  {
    role: "draft",
    instruction:
      "You are the Drafter. Give a first, direct answer to the task. Be concise — a few sentences.",
  },
  {
    role: "critique",
    instruction:
      "You are the Critic. List the concrete flaws, missing points, or errors in the draft. Be specific and brief — bullet points.",
  },
  {
    role: "revise",
    instruction:
      "You are the Finalizer. Using the draft and the critique, write the final improved answer. Output ONLY the final answer, no preamble.",
  },
];

export interface PipelineEvents {
  onStepStart?: (seq: number, role: string) => void;
  onStepDone?: (step: PipelineStep) => void | Promise<void>;
}

export async function runPipeline(
  model: string,
  prompt: string,
  ev: PipelineEvents = {},
): Promise<{ steps: PipelineStep[]; answer: string }> {
  const steps: PipelineStep[] = [];
  let draft = "";
  let critique = "";

  for (const def of ROLES) {
    const seq = steps.length;
    ev.onStepStart?.(seq, def.role);
    const input =
      def.role === "draft"
        ? `Task: ${prompt}`
        : def.role === "critique"
          ? `Task: ${prompt}\n\nDraft answer:\n${draft}`
          : `Task: ${prompt}\n\nDraft:\n${draft}\n\nCritique:\n${critique}`;
    const output = await callModel(model, `${def.instruction}\n\n${input}`);
    const step: PipelineStep = { seq, role: def.role, model, input, output };
    steps.push(step);
    await ev.onStepDone?.(step);
    if (def.role === "draft") draft = output;
    if (def.role === "critique") critique = output;
  }

  return { steps, answer: steps[steps.length - 1].output };
}
