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
interface TraceStep {
  key: string;
  label: string;
  state: StepState;
  detail?: string;
  role?: string; // draft | critique | revise
  output?: string;
  outputOk?: boolean | null;
}

const ROLE_LABEL: Record<string, string> = {
  draft: "Draft · Fugu Ultra",
  critique: "Critique · Fugu Ultra",
  revise: "Revise · Fugu Ultra (final)",
};

const skeleton = (): TraceStep[] => [
  { key: "input", label: "Hash task input", state: "pending" },
  { key: "policy", label: "Evaluate routing policy", state: "pending" },
  { key: "route", label: "Route → fugu-ultra", state: "pending" },
  { key: "p0", label: ROLE_LABEL.draft, state: "pending", role: "draft" },
  { key: "p1", label: ROLE_LABEL.critique, state: "pending", role: "critique" },
  { key: "p2", label: ROLE_LABEL.revise, state: "pending", role: "revise" },
  { key: "sign", label: "Sign receipt · KMS enclave wallet", state: "pending" },
  { key: "chain", label: "Chain receipt", state: "pending" },
];

function StepIcon({ state }: { state: StepState }) {
  if (state === "active") return <Loader2 className="size-4 animate-spin text-foreground" />;
  if (state === "done") return <CheckCircle2 className="size-4 text-success" />;
  if (state === "fail") return <XCircle className="size-4 text-destructive" />;
  return <Circle className="size-4 text-muted-foreground/40" />;
}

function Trace({ steps, elapsed }: { steps: TraceStep[]; elapsed: number }) {
  return (
    <ol className="space-y-0">
      {steps.map((s, i) => {
        const last = i === steps.length - 1;
        const active = s.state === "active";
        const done = s.state === "done";
        const isPipe = !!s.role;
        return (
          <li key={s.key} className="relative flex gap-3 pb-4">
            {!last && <span className={cn("absolute left-[7px] top-5 h-full w-px", done ? "bg-success/40" : "bg-border")} />}
            <span className="z-10 mt-0.5 shrink-0"><StepIcon state={s.state} /></span>
            <div className="min-w-0 flex-1">
              <div className={cn("flex items-center gap-2 text-sm", active || done ? "text-foreground" : "text-muted-foreground")}>
                {isPipe && <Badge variant="secondary" className="font-mono text-[10px]">agent</Badge>}
                <span>{s.label}</span>
                {active && <span className="font-mono text-[11px] text-muted-foreground">{elapsed.toFixed(1)}s</span>}
                {isPipe && done && s.outputOk != null && (
                  <span className={cn("font-mono text-[10px]", s.outputOk ? "text-success" : "text-destructive")}>
                    {s.outputOk ? "output_hash ✓" : "output_hash ✗"}
                  </span>
                )}
              </div>
              {s.detail && <div className="mt-1 font-mono text-[11px] text-muted-foreground break-all">{s.detail}</div>}
              {s.output && (
                <div className="mt-1.5 rounded-md border bg-input/30 p-2.5 text-[13px] leading-relaxed whitespace-pre-wrap break-words text-muted-foreground">
                  {s.output}
                </div>
              )}
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
  const [steps, setSteps] = useState<TraceStep[]>([]);
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

  const patch = (key: string, p: Partial<TraceStep>) =>
    setSteps((prev) => prev.map((s) => (s.key === key ? { ...s, ...p } : s)));

  const startTimer = () => {
    const t0 = Date.now();
    setElapsed(0);
    if (timer.current) clearInterval(timer.current);
    timer.current = setInterval(() => setElapsed((Date.now() - t0) / 1000), 100);
  };
  const stopTimer = () => { if (timer.current) { clearInterval(timer.current); timer.current = null; } };

  async function route() {
    if (!prompt.trim() || busy) return;
    setBusy(true);
    setError("");
    setResult(null);
    setSteps(skeleton());

    try {
      const res = await fetch("/route/stream", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt }),
      });
      if (!res.ok || !res.body) throw new Error(`stream failed (${res.status})`);

      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";

      const handle = async (ev: any) => {
        if (ev.error) { setError(ev.error); stopTimer(); return; }
        if (ev.id) { patch(ev.id, { state: "done", detail: ev.detail }); return; }
        if (ev.pstep) {
          const key = `p${ev.seq}`;
          if (ev.state === "active") { patch(key, { state: "active" }); startTimer(); }
          else {
            stopTimer();
            const ok = ev.output_hash ? (await sha256Hex(ev.output)) === ev.output_hash : null;
            patch(key, { state: "done", output: ev.output, outputOk: ok });
          }
          return;
        }
        if (ev.done) {
          const v = await verifyReceipt(ev.receipt, prompt, ev.answer);
          setResult({ answer: ev.answer, receipt: ev.receipt, v });
          await loadChain();
        }
      };

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (line) await handle(JSON.parse(line));
        }
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      stopTimer();
      setBusy(false);
    }
  }

  const tee = info?.attestation.source === "tee";

  return (
    <TooltipProvider>
      <div className="mx-auto max-w-4xl px-5 py-8 pb-20">
        <nav className="mb-8 flex items-center justify-between border-b pb-4">
          <img src="/eigenlabs-logo.png" alt="Eigen Labs" className="h-5 w-auto opacity-90" />
          <a href="https://www.eigencloud.xyz/" target="_blank" rel="noreferrer" className="font-mono text-[11px] text-muted-foreground hover:text-foreground">EigenCompute ↗</a>
        </nav>

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
              <Cpu />{info ? (tee ? "inside TEE" : "local-dev") : "…"}
            </Badge>
            <span className="inline-flex items-center gap-1.5">
              signer {info ? <span className="cursor-default">{short(info.signer, 12)}</span> : "…"}
              {info?.attestation.key_source === "kms-mnemonic" && (
                <Tooltip>
                  <TooltipTrigger className="cursor-default">
                    <Badge variant="outline" className="gap-1 border-success/30 bg-success/10 text-success"><KeyRound />KMS</Badge>
                  </TooltipTrigger>
                  <TooltipContent>KMS-derived enclave wallet — verify it equals the app's Derived Address on the dashboard</TooltipContent>
                </Tooltip>
              )}
            </span>
            {info?.attestation.verify_url ? (
              <a href={info.attestation.verify_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-foreground hover:underline">verify attestation <ExternalLink className="size-3" /></a>
            ) : (<span>set ECLOUD_APP_ID for verify link</span>)}
          </div>
        </header>

        <Card className="mb-4">
          <CardHeader>
            <CardTitle>Route a task</CardTitle>
            <CardDescription>Watch the enclave conduct a draft → critique → revise pipeline and sign every step.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="describe a task…" className="min-h-24"
              onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") route(); }} />
            <div className="flex items-center gap-3">
              <Button onClick={route} disabled={busy}>{busy ? "Orchestrating…" : "Route task"}</Button>
              {error && <span className="font-mono text-[11px] text-destructive">{error}</span>}
            </div>
          </CardContent>
        </Card>

        {steps.length > 0 && (
          <Card className="mb-4">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">Orchestration<Badge variant="secondary" className="font-mono">in the enclave</Badge></CardTitle>
              <CardDescription>
                Each agent step is a real Fugu Ultra call (Fugu orchestrates frontier models internally); Waybill
                conducts the multi-step pipeline and signs every handoff into the receipt.
              </CardDescription>
            </CardHeader>
            <CardContent><Trace steps={steps} elapsed={elapsed} /></CardContent>
          </Card>
        )}

        {result && (
          <Card className="mb-4">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">Final answer<Badge variant="secondary" className="font-mono">{result.receipt.chosen_model}</Badge></CardTitle>
              <CardDescription>Re-verified in your browser — trust no one.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-lg border bg-input/30 p-3 text-sm whitespace-pre-wrap break-words">{result.answer}</div>
              <div className="flex flex-wrap gap-2">
                <Check ok={result.v.hashOk}>receipt hash matches body</Check>
                <Check ok={result.v.sigOk}>signature → {short(result.v.recovered, 12)}</Check>
                <Check ok={result.v.inputOk}>input_hash matches prompt</Check>
                <Check ok={result.v.respOk}>response_hash matches answer</Check>
                {result.receipt.anchor_tx && info?.anchoring ? (<Check ok>anchored on-chain</Check>) : (
                  <Badge variant="secondary">{result.receipt.anchor_tx ? "anchor present (set RPC to check)" : "signed + hash-chained"}</Badge>
                )}
              </div>
              <dl className="grid grid-cols-[130px_1fr] gap-x-4 gap-y-2">
                <Field k="chosen_model" v={result.receipt.chosen_model} hl />
                <Field k="steps" v={(result.receipt.steps ?? []).map((s) => s.role).join(" → ") || "—"} />
                <Field k="seq" v={String(result.receipt.seq)} />
                <Field k="task_id" v={result.receipt.task_id} />
                <Field k="input_hash" v={result.receipt.input_hash} />
                <Field k="response_hash" v={result.receipt.response_hash} />
                <Field k="policy_hash" v={result.receipt.policy_hash} />
                <Field k="prev_hash" v={result.receipt.prev_hash} />
                <Field k="hash" v={result.receipt.hash} hl />
                <Field k="signature" v={result.receipt.signature} />
                <Field k="signer" v={result.receipt.signer} hl />
              </dl>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">Receipt chain{chain.length > 0 && <Badge variant="secondary" className="font-mono">{chain.length}</Badge>}</CardTitle>
            <CardDescription>Hash-chained log for this run — suppression and reordering are detectable.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full font-mono text-xs">
                <thead><tr>{["seq", "model", "steps", "hash", "prev"].map((h) => (<th key={h} className="px-2.5 py-2 text-left text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{h}</th>))}</tr></thead>
                <tbody>
                  {chain.length === 0 ? (
                    <tr><td colSpan={5} className="px-2.5 py-3 text-muted-foreground">no receipts yet</td></tr>
                  ) : (
                    chain.map((r) => (
                      <tr key={r.hash} className="border-t">
                        <td className="px-2.5 py-2 align-middle text-muted-foreground">{r.seq}</td>
                        <td className="px-2.5 py-2 align-middle"><Badge variant="secondary" className="font-mono">{r.chosen_model}</Badge></td>
                        <td className="px-2.5 py-2 align-middle text-muted-foreground">{(r.steps ?? []).length || "—"}</td>
                        <td className="px-2.5 py-2 align-middle">{short(r.hash, 14)}</td>
                        <td className="px-2.5 py-2 align-middle">{short(r.prev_hash, 10)}</td>
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
    <Badge variant="outline" className="gap-1.5 border-success/30 bg-success/10 text-success"><CheckCircle2 />{children}</Badge>
  ) : (
    <Badge variant="destructive" className="gap-1.5"><XCircle />{children}</Badge>
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
