import { useEffect, useState } from "react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Textarea,
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

function Check({ ok, label }: { ok: boolean; label: string }) {
  return (
    <Badge
      variant="outline"
      className={
        "gap-1.5 " +
        (ok
          ? "text-emerald-400 border-emerald-400/30 bg-emerald-400/10"
          : "text-destructive border-destructive/30 bg-destructive/10")
      }
    >
      {ok ? <CheckCircle2 className="size-3" /> : <XCircle className="size-3" />}
      {label}
    </Badge>
  );
}

function Field({ k, v, hl }: { k: string; v: string; hl?: boolean }) {
  return (
    <>
      <div className="mono text-[11px] text-muted-foreground pt-0.5">{k}</div>
      <div className={"mono text-xs break-all " + (hl ? "text-foreground" : "text-muted-foreground")}>
        {v}
      </div>
    </>
  );
}

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
    if (!prompt.trim()) return;
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
    <div className="mx-auto max-w-4xl px-5 py-8 pb-20">
      {/* Header */}
      <header className="mb-7 flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <ShieldCheck className="size-6 text-primary" />
          <div>
            <h1 className="font-heading text-2xl tracking-tight">Waybill</h1>
            <p className="mono text-[11px] text-muted-foreground">
              verifiable Fugu-style orchestrator · TDX enclave
            </p>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1.5 mono text-[11px] text-muted-foreground">
          <Badge
            variant="outline"
            className={
              "gap-1.5 " +
              (tee
                ? "text-emerald-400 border-emerald-400/30 bg-emerald-400/10"
                : "text-amber-400 border-amber-400/30 bg-amber-400/10")
            }
          >
            <Cpu className="size-3" />
            {info ? (tee ? "inside TEE" : "local-dev") : "…"}
          </Badge>
          <span>signer {short(info?.signer, 12)}</span>
          {info?.attestation.verify_url ? (
            <a
              href={info.attestation.verify_url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-primary hover:underline"
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
          <CardTitle className="mono text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Route a task
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="describe a task…"
            className="min-h-24"
          />
          <div className="flex items-center gap-3">
            <Button onClick={route} disabled={busy}>
              {busy ? "Routing…" : "Route task"}
            </Button>
            <span className="mono text-[11px] text-muted-foreground">{status}</span>
          </div>
        </CardContent>
      </Card>

      {/* Result */}
      {result && (
        <Card className="mb-4">
          <CardHeader>
            <CardTitle className="mono text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Answer + signed receipt
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-lg border bg-secondary/40 p-3 text-sm whitespace-pre-wrap break-words">
              {result.answer}
            </div>
            <div className="flex flex-wrap gap-2">
              <Check ok={result.v.hashOk} label="receipt hash matches body" />
              <Check ok={result.v.sigOk} label={`signature → ${short(result.v.recovered, 12)}`} />
              <Check ok={result.v.inputOk} label="input_hash matches prompt" />
              <Check ok={result.v.respOk} label="response_hash matches answer" />
              {result.receipt.anchor_tx && info?.anchoring ? (
                <Check ok label="anchored on-chain" />
              ) : (
                <Badge variant="outline" className="gap-1.5 text-muted-foreground">
                  {result.receipt.anchor_tx ? "anchor present (set RPC to check)" : "local mode · not anchored"}
                </Badge>
              )}
            </div>
            <div className="grid grid-cols-[130px_1fr] gap-x-4 gap-y-2">
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
            </div>
          </CardContent>
        </Card>
      )}

      {/* Chain */}
      <Card>
        <CardHeader>
          <CardTitle className="mono text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Receipt chain {chain.length > 0 && <span className="text-muted-foreground">· {chain.length}</span>}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full mono text-xs">
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th className="px-2.5 py-2 font-medium uppercase tracking-wide">seq</th>
                  <th className="px-2.5 py-2 font-medium uppercase tracking-wide">model</th>
                  <th className="px-2.5 py-2 font-medium uppercase tracking-wide">hash</th>
                  <th className="px-2.5 py-2 font-medium uppercase tracking-wide">prev</th>
                  <th className="px-2.5 py-2 font-medium uppercase tracking-wide">anchor</th>
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
                    <tr key={r.hash} className="border-t text-muted-foreground">
                      <td className="px-2.5 py-2">{r.seq}</td>
                      <td className="px-2.5 py-2 text-primary">{r.chosen_model}</td>
                      <td className="px-2.5 py-2">{short(r.hash, 14)}</td>
                      <td className="px-2.5 py-2">{short(r.prev_hash, 10)}</td>
                      <td className="px-2.5 py-2">
                        {r.anchor_tx ? (
                          <a
                            href={`https://sepolia.etherscan.io/tx/${r.anchor_tx}`}
                            target="_blank"
                            rel="noreferrer"
                            className="text-primary hover:underline"
                          >
                            {short(r.anchor_tx, 10)}
                          </a>
                        ) : (
                          "—"
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
  );
}
