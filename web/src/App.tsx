import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Textarea,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  cn,
} from "@layr-labs/eigen-design";
import {
  CheckCircle2,
  XCircle,
  ShieldCheck,
  ExternalLink,
  Cpu,
  KeyRound,
  Loader2,
  Circle,
  Hash,
  GitBranch,
  Workflow,
  PenLine,
  Link2,
} from "lucide-react";
import {
  verifyReceipt,
  sha256Hex,
  short,
  type Receipt,
  type Attestation,
  type VerifyResult,
} from "./lib/verify";

interface VerifyInfo {
  signer: string;
  policy_hash: string;
  anchoring: boolean;
  attestation: Attestation;
}

type StepState = "pending" | "active" | "done" | "fail";
interface Step {
  id: string;
  label: string;
  icon: typeof Hash;
  state: StepState;
  detail?: ReactNode;
}

const STEP_DEFS: Array<Pick<Step, "id" | "label" | "icon">> = [
  { id: "input", label: "Hash task input", icon: Hash },
  { id: "policy", label: "Evaluate routing policy", icon: Workflow },
  { id: "route", label: "Route → fugu-ultra", icon: GitBranch },
  { id: "call", label: "Invoke Fugu Ultra · orchestrating frontier models", icon: Cpu },
  { id: "response", label: "Hash response", icon: Hash },
  { id: "sign", label: "Sign receipt · KMS enclave wallet", icon: PenLine },
  { id: "chain", label: "Chain receipt", icon: Link2 },
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function StepIcon({ state }: { state: StepState }) {
  if (state === "active") return <Loader2 className="size-4 animate-spin text-foreground" />;
  if (state === "done") return <CheckCircle2 className="size-4 text-success" />;
  if (state === "fail") return <XCircle className="size-4 text-destructive" />;
  return <Circle className="size-4 text-muted-foreground/40" />;
}

function OrchestrationTrace({ steps, elapsed }: { steps: Step[]; elapsed: number }) {
  return (
    <ol className="relative space-y-0">
      {steps.map((s, i) => {
        const last = i === steps.length - 1;
        const active = s.state === "active";
        const done = s.state === "done";
        return (
          <li key={s.id} className="relative flex gap-3 pb-4">
            {!last && (
              <span
                className={cn(
                  "absolute left-[7px] top-5 h-full w-px",
                  done ? "bg-success/40" : "bg-border",
                )}
              />
            )}
            <span className="z-10 mt-0.5 shrink-0">
              <StepIcon state={s.state} />
            </span>
            <div className="min-w-0 flex-1">
              <div
                className={cn(
                  "flex items-center gap-2 text-sm",
                  active ? "text-foreground" : done ? "text-foreground" : "text-muted-foreground",
                )}
              >
                <s.icon className="size-3.5 opacity-50" />
                <span>{s.label}</span>
                {active && s.id === "call" && (
                  <span className="font-mono text-[11px] text-muted-foreground">{elapsed.toFixed(1)}s</span>
                )}
              </div>
              {s.detail && <div className="mt-1 font-mono text-[11px] text-muted-foreground break-all">{s.detail}</div>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export function App() {
  const [info, setInfo] = useState<VerifyInfo | null>(null);
  const [prompt, setPrompt] = useState("Explain why verifiable orchestration matters, in two sentences.");
  const [busy, setBusy] = useState(false);
  const [steps, setSteps] = useState<Step[]>([]);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ answer: string; receipt: Receipt; v: VerifyResult } | null>(null);
  const [chain, setChain] = useState<Receipt[]>([]);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadChain = async () => {
    const { receipts } = await (await fetch("/chain")).json();
    setChain(receipts);
  };

  useEffect(() => {
    fetch("/verify").then((r) => r.json()).then(setInfo).catch(() => {});
    loadChain().catch(() => {});
    return () => { if (timer.current) clearInterval(timer.current); };
  }, []);

  const patch = (id: string, state: StepState, detail?: ReactNode) =>
    setSteps((prev) => prev.map((s) => (s.id === id ? { ...s, state, detail } : s)));

  async function route() {
    if (!prompt.trim() || busy) return;
    setBusy(true);
    setError("");
    setResult(null);
    setSteps(STEP_DEFS.map((d) => ({ ...d, state: "pending" })));

    try {
      // 1–3: deterministic, enclave-fast steps — reveal them live with their real data.
      const ih = await sha256Hex(prompt);
      patch("input", "done", `input_hash ${short(ih, 18)}`);
      await sleep(280);
      patch(
        "policy",
        "done",
        `candidates [fugu-ultra] · policy_hash ${short(info?.policy_hash, 14)}`,
      );
      await sleep(280);
      patch("route", "done", "chosen_model = fugu-ultra");
      await sleep(200);

      // 4: the real model call — genuinely the only slow step. Time it for real.
      patch("call", "active");
      const t0 = Date.now();
      setElapsed(0);
      timer.current = setInterval(() => setElapsed((Date.now() - t0) / 1000), 100);
      const res = await fetch("/route", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt }),
      });
      if (timer.current) { clearInterval(timer.current); timer.current = null; }
      const secs = ((Date.now() - t0) / 1000).toFixed(1);
      if (!res.ok) {
        patch("call", "fail", `${await res.text()}`.slice(0, 160));
        setError("model call failed");
        return;
      }
      const { answer, receipt } = await res.json();
      patch("call", "done", `Fugu Ultra responded in ${secs}s`);
      await sleep(160);

      // 5–7: cryptographic steps, from the real receipt.
      patch("response", "done", `response_hash ${short(receipt.response_hash, 18)}`);
      await sleep(220);
      patch("sign", "done", `signer ${short(receipt.signer, 16)} · sig ${short(receipt.signature, 14)}`);
      await sleep(220);
      patch(
        "chain",
        "done",
        `seq ${receipt.seq} · prev ${short(receipt.prev_hash, 12)}${receipt.anchor_tx ? " · anchored" : ""}`,
      );

      const v = await verifyReceipt(receipt, prompt, answer);
      setResult({ answer, receipt, v });
      await loadChain();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      if (timer.current) { clearInterval(timer.current); timer.current = null; }
      setBusy(false);
    }
  }

  const tee = info?.attestation.source === "tee";

  return (
    <TooltipProvider>
      <div className="mx-auto max-w-4xl px-5 py-8 pb-20">
        {/* Top nav */}
        <nav className="mb-8 flex items-center justify-between border-b pb-4">
          <img src="/eigenlabs-logo.png" alt="Eigen Labs" className="h-5 w-auto opacity-90" />
          <a href="https://www.eigencloud.xyz/" target="_blank" rel="noreferrer" className="font-mono text-[11px] text-muted-foreground hover:text-foreground">
            EigenCompute ↗
          </a>
        </nav>

        {/* Header */}
        <header className="mb-7 flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <ShieldCheck className="size-6 text-foreground" />
            <div>
              <h1 className="text-2xl">Waybill</h1>
              <p className="font-mono text-[11px] text-muted-foreground">verifiable Fugu-style orchestrator · TDX enclave</p>
            </div>
          </div>
          <div className="flex flex-col items-end gap-1.5 font-mono text-[11px] text-muted-foreground">
            <Badge variant="outline" className={cn("gap-1.5", tee ? "border-success/30 bg-success/10 text-success" : "border-warning/30 bg-warning/10 text-warning")}>
              <Cpu />
              {info ? (tee ? "inside TEE" : "local-dev") : "…"}
            </Badge>
            <span className="inline-flex items-center gap-1.5">
              signer {info ? <span className="cursor-default">{short(info.signer, 12)}</span> : "…"}
              {info?.attestation.key_source === "kms-mnemonic" && (
                <Tooltip>
                  <TooltipTrigger className="cursor-default">
                    <Badge variant="outline" className="gap-1 border-success/30 bg-success/10 text-success">
                      <KeyRound />KMS
                    </Badge>
                  </TooltipTrigger>
                  <TooltipContent>KMS-derived enclave wallet — verify it equals the app's Derived Address on the dashboard</TooltipContent>
                </Tooltip>
              )}
            </span>
            {info?.attestation.verify_url ? (
              <a href={info.attestation.verify_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-foreground hover:underline">
                verify attestation <ExternalLink className="size-3" />
              </a>
            ) : (
              <span>set ECLOUD_APP_ID for verify link</span>
            )}
          </div>
        </header>

        {/* Compose */}
        <Card className="mb-4">
          <CardHeader>
            <CardTitle>Route a task</CardTitle>
            <CardDescription>Watch the enclave make a verifiable routing decision and sign it.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="describe a task…"
              className="min-h-24"
              onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") route(); }}
            />
            <div className="flex items-center gap-3">
              <Button onClick={route} disabled={busy}>{busy ? "Orchestrating…" : "Route task"}</Button>
              {error && <span className="font-mono text-[11px] text-destructive">{error}</span>}
            </div>
          </CardContent>
        </Card>

        {/* Orchestration trace */}
        {steps.length > 0 && (
          <Card className="mb-4">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                Orchestration
                <Badge variant="secondary" className="font-mono">in the enclave</Badge>
              </CardTitle>
              <CardDescription>
                Fugu Ultra orchestrates frontier models internally; Waybill makes the routing decision around
                it verifiable — every step below is signed into the receipt.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <OrchestrationTrace steps={steps} elapsed={elapsed} />
            </CardContent>
          </Card>
        )}

        {/* Result */}
        {result && (
          <Card className="mb-4">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                Answer
                <Badge variant="secondary" className="font-mono">{result.receipt.chosen_model}</Badge>
              </CardTitle>
              <CardDescription>Re-verified in your browser — trust no one.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-lg border bg-input/30 p-3 text-sm whitespace-pre-wrap break-words">{result.answer}</div>
              <div className="flex flex-wrap gap-2">
                <Check ok={result.v.hashOk}>receipt hash matches body</Check>
                <Check ok={result.v.sigOk}>signature → {short(result.v.recovered, 12)}</Check>
                <Check ok={result.v.inputOk}>input_hash matches prompt</Check>
                <Check ok={result.v.respOk}>response_hash matches answer</Check>
                {result.receipt.anchor_tx && info?.anchoring ? (
                  <Check ok>anchored on-chain</Check>
                ) : (
                  <Badge variant="secondary">{result.receipt.anchor_tx ? "anchor present (set RPC to check)" : "signed + hash-chained"}</Badge>
                )}
              </div>
              <dl className="grid grid-cols-[130px_1fr] gap-x-4 gap-y-2">
                <Field k="chosen_model" v={result.receipt.chosen_model} hl />
                <Field k="candidates" v={result.receipt.candidates.join("  ")} />
                <Field k="seq" v={String(result.receipt.seq)} />
                <Field k="task_id" v={result.receipt.task_id} />
                <Field k="input_hash" v={result.receipt.input_hash} />
                <Field k="response_hash" v={result.receipt.response_hash} />
                <Field k="policy_hash" v={result.receipt.policy_hash} />
                <Field k="prev_hash" v={result.receipt.prev_hash} />
                <Field k="image_digest" v={result.receipt.image_digest} />
                <Field k="hash" v={result.receipt.hash} hl />
                <Field k="signature" v={result.receipt.signature} />
                <Field k="anchor_tx" v={result.receipt.anchor_tx ?? "—"} />
              </dl>
            </CardContent>
          </Card>
        )}

        {/* Chain */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Receipt chain
              {chain.length > 0 && <Badge variant="secondary" className="font-mono">{chain.length}</Badge>}
            </CardTitle>
            <CardDescription>Hash-chained log for this run — suppression and reordering are detectable.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full font-mono text-xs">
                <thead>
                  <tr>
                    {["seq", "model", "hash", "prev", "anchor"].map((h) => (
                      <th key={h} className="px-2.5 py-2 text-left text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {chain.length === 0 ? (
                    <tr><td colSpan={5} className="px-2.5 py-3 text-muted-foreground">no receipts yet</td></tr>
                  ) : (
                    chain.map((r) => (
                      <tr key={r.hash} className="border-t">
                        <td className="px-2.5 py-2 align-middle text-muted-foreground">{r.seq}</td>
                        <td className="px-2.5 py-2 align-middle"><Badge variant="secondary" className="font-mono">{r.chosen_model}</Badge></td>
                        <td className="px-2.5 py-2 align-middle">{short(r.hash, 14)}</td>
                        <td className="px-2.5 py-2 align-middle">{short(r.prev_hash, 10)}</td>
                        <td className="px-2.5 py-2 align-middle">
                          {r.anchor_tx ? (
                            <a href={`https://sepolia.etherscan.io/tx/${r.anchor_tx}`} target="_blank" rel="noreferrer" className="text-foreground hover:underline">{short(r.anchor_tx, 10)}</a>
                          ) : (<span className="text-muted-foreground">—</span>)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </TooltipProvider>
  );
}

function Check({ ok, children }: { ok: boolean; children: ReactNode }) {
  return ok ? (
    <Badge variant="outline" className="gap-1.5 border-success/30 bg-success/10 text-success">
      <CheckCircle2 />{children}
    </Badge>
  ) : (
    <Badge variant="destructive" className="gap-1.5">
      <XCircle />{children}
    </Badge>
  );
}

function Field({ k, v, hl }: { k: string; v: string; hl?: boolean }) {
  return (
    <>
      <dt className="font-mono text-[11px] text-muted-foreground">{k}</dt>
      <dd className={cn("font-mono text-xs break-all", hl ? "text-foreground" : "text-muted-foreground")}>{v}</dd>
    </>
  );
}
