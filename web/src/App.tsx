import { useEffect, useState, type ReactNode } from "react";
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
import { CheckCircle2, XCircle, ShieldCheck, ExternalLink, Cpu } from "lucide-react";
import {
  verifyReceipt,
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

/** A pass/fail check — pass uses the success token, fail uses the destructive variant. */
function Check({ ok, children }: { ok: boolean; children: ReactNode }) {
  return ok ? (
    <Badge variant="outline" className="gap-1.5 border-success/30 bg-success/10 text-success">
      <CheckCircle2 />
      {children}
    </Badge>
  ) : (
    <Badge variant="destructive" className="gap-1.5">
      <XCircle />
      {children}
    </Badge>
  );
}

/** Truncated monospace value with the full string in a tooltip. */
function Trunc({ value, n = 10 }: { value: string | null; n?: number }) {
  if (!value || value === "—") return <span className="text-muted-foreground">—</span>;
  return (
    <Tooltip>
      <TooltipTrigger className="cursor-default font-mono">{short(value, n)}</TooltipTrigger>
      <TooltipContent className="font-mono">{value}</TooltipContent>
    </Tooltip>
  );
}

function Field({ k, v, hl }: { k: string; v: string; hl?: boolean }) {
  return (
    <>
      <dt className="font-mono text-[11px] text-muted-foreground">{k}</dt>
      <dd className={cn("font-mono text-xs break-all", hl ? "text-foreground" : "text-muted-foreground")}>
        {v}
      </dd>
    </>
  );
}

const TH = "px-2.5 py-2 text-left text-[11px] font-medium uppercase tracking-wide text-muted-foreground";
const TD = "px-2.5 py-2 align-middle";

export function App() {
  const [info, setInfo] = useState<VerifyInfo | null>(null);
  const [prompt, setPrompt] = useState("fix the bug in this function");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("routes inside the enclave → signs a receipt → anchors it");
  const [result, setResult] = useState<{ answer: string; receipt: Receipt; v: VerifyResult } | null>(
    null,
  );
  const [chain, setChain] = useState<Receipt[]>([]);

  const loadChain = async () => {
    const { receipts } = await (await fetch("/chain")).json();
    setChain(receipts);
  };

  useEffect(() => {
    fetch("/verify")
      .then((r) => r.json())
      .then(setInfo)
      .catch(() => {});
    loadChain().catch(() => {});
  }, []);

  const route = async () => {
    if (!prompt.trim() || busy) return;
    setBusy(true);
    setStatus("routing…");
    try {
      const res = await fetch("/route", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt }),
      });
      if (!res.ok) throw new Error(await res.text());
      const { answer, receipt } = await res.json();
      const v = await verifyReceipt(receipt, prompt, answer);
      setResult({ answer, receipt, v });
      await loadChain();
      setStatus("verified in your browser ✓");
    } catch (e) {
      setStatus("error: " + (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const tee = info?.attestation.source === "tee";

  return (
    <TooltipProvider>
      <div className="mx-auto max-w-4xl px-5 py-8 pb-20">
        {/* Header */}
        <header className="mb-7 flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <ShieldCheck className="size-6 text-foreground" />
            <div>
              <h1 className="text-2xl">Waybill</h1>
              <p className="font-mono text-[11px] text-muted-foreground">
                verifiable Fugu-style orchestrator · TDX enclave
              </p>
            </div>
          </div>
          <div className="flex flex-col items-end gap-1.5 font-mono text-[11px] text-muted-foreground">
            <Badge
              variant="outline"
              className={cn(
                "gap-1.5",
                tee
                  ? "border-success/30 bg-success/10 text-success"
                  : "border-warning/30 bg-warning/10 text-warning",
              )}
            >
              <Cpu />
              {info ? (tee ? "inside TEE" : "local-dev") : "…"}
            </Badge>
            <span>
              signer{" "}
              {info ? <Trunc value={info.signer} n={12} /> : "…"}
            </span>
            {info?.attestation.verify_url ? (
              <a
                href={info.attestation.verify_url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-foreground hover:underline"
              >
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
            <CardDescription>Pick a model, call it, sign a receipt, anchor it.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="describe a task…"
              className="min-h-24"
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") route();
              }}
            />
            <div className="flex items-center gap-3">
              <Button onClick={route} disabled={busy}>
                {busy ? "Routing…" : "Route task"}
              </Button>
              <span className="font-mono text-[11px] text-muted-foreground">{status}</span>
            </div>
          </CardContent>
        </Card>

        {/* Result */}
        {result && (
          <Card className="mb-4">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                Answer
                <Badge variant="secondary" className="font-mono">
                  {result.receipt.chosen_model}
                </Badge>
              </CardTitle>
              <CardDescription>Re-verified in your browser — trust no one.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-lg border bg-input/30 p-3 text-sm whitespace-pre-wrap break-words">
                {result.answer}
              </div>
              <div className="flex flex-wrap gap-2">
                <Check ok={result.v.hashOk}>receipt hash matches body</Check>
                <Check ok={result.v.sigOk}>signature → {short(result.v.recovered, 12)}</Check>
                <Check ok={result.v.inputOk}>input_hash matches prompt</Check>
                <Check ok={result.v.respOk}>response_hash matches answer</Check>
                {result.receipt.anchor_tx && info?.anchoring ? (
                  <Check ok>anchored on-chain</Check>
                ) : (
                  <Badge variant="secondary">
                    {result.receipt.anchor_tx
                      ? "anchor present (set RPC to check)"
                      : "local mode · not anchored"}
                  </Badge>
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
              {chain.length > 0 && (
                <Badge variant="secondary" className="font-mono">
                  {chain.length}
                </Badge>
              )}
            </CardTitle>
            <CardDescription>Hash-chained log for this run — suppression and reordering are detectable.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full font-mono text-xs">
                <thead>
                  <tr>
                    <th className={TH}>seq</th>
                    <th className={TH}>model</th>
                    <th className={TH}>hash</th>
                    <th className={TH}>prev</th>
                    <th className={TH}>anchor</th>
                  </tr>
                </thead>
                <tbody>
                  {chain.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-2.5 py-3 text-muted-foreground">
                        no receipts yet
                      </td>
                    </tr>
                  ) : (
                    chain.map((r) => (
                      <tr key={r.hash} className="border-t">
                        <td className={cn(TD, "text-muted-foreground")}>{r.seq}</td>
                        <td className={TD}>
                          <Badge variant="secondary" className="font-mono">
                            {r.chosen_model}
                          </Badge>
                        </td>
                        <td className={TD}>
                          <Trunc value={r.hash} n={14} />
                        </td>
                        <td className={TD}>
                          <Trunc value={r.prev_hash} n={10} />
                        </td>
                        <td className={TD}>
                          {r.anchor_tx ? (
                            <a
                              href={`https://sepolia.etherscan.io/tx/${r.anchor_tx}`}
                              target="_blank"
                              rel="noreferrer"
                              className="text-foreground hover:underline"
                            >
                              {short(r.anchor_tx, 10)}
                            </a>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
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
