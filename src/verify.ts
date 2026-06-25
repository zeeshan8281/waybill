#!/usr/bin/env -S npx tsx
/**
 * Public verifier CLI — trust no one, check the receipt yourself.
 *
 *   npm run verify keygen
 *   npm run verify receipt receipt.json [--prompt "..."] [--answer "..."]
 *   npm run verify chain chain.json
 *
 * What it checks (offline unless WAYBILL_RPC_URL is set for the anchor step):
 *   1. receipt hash recomputes from the body
 *   2. signature recovers to the receipt's signer address
 *   3. (chain) prev_hash links and seq is monotonic from 0
 *   4. (--prompt/--answer) input_hash/response_hash match what you actually got
 *   5. (RPC set) anchor_tx is mined, from the signer, calldata == receipt hash
 *
 * The enclave/image step (TD Quote + on-chain image digest) is the EigenCompute
 * verify dashboard: https://verify-sepolia.eigencloud.xyz/app/<APP_ID>
 */
import "./env.js"; // load .env before anchor.ts reads WAYBILL_RPC_URL

import { readFileSync } from "node:fs";

import { Wallet } from "ethers";

import * as anchor from "./anchor.js";
import * as receiptMod from "./receipt.js";
import * as signer from "./signer.js";

const DOC = `usage:
  verify keygen
  verify receipt receipt.json [--prompt "..."] [--answer "..."]
  verify chain chain.json`;

function check(label: string, ok: boolean): boolean {
  console.log(`  [${ok ? "OK " : "FAIL"}] ${label}`);
  return ok;
}

async function verifyReceipt(
  rcpt: Record<string, any>,
  prompt?: string,
  answer?: string,
): Promise<boolean> {
  console.log(`receipt seq=${rcpt.seq} model=${rcpt.chosen_model}`);
  let ok = true;

  const recomputed = receiptMod.receiptHash(rcpt);
  ok = check("receipt hash matches body", recomputed === rcpt.hash) && ok;

  const recovered = signer.recover(rcpt.hash, rcpt.signature);
  const signerAddr = rcpt.signer ?? recovered;
  ok = check(`signature -> ${recovered}`, recovered.toLowerCase() === signerAddr.toLowerCase()) && ok;

  if (prompt !== undefined) {
    ok = check("input_hash matches prompt", receiptMod.sha256Hex(prompt) === rcpt.input_hash) && ok;
  }
  if (answer !== undefined) {
    ok = check("response_hash matches answer", receiptMod.sha256Hex(answer) === rcpt.response_hash) && ok;
  }

  const tx: string | undefined = rcpt.anchor_tx;
  if (tx && anchor.enabled()) {
    ok = check(`anchored on-chain tx=${tx.slice(0, 12)}…`, await anchor.verifyAnchor(tx, rcpt.hash, recovered)) && ok;
  } else if (tx) {
    console.log(`  [skip] anchor present (tx=${tx.slice(0, 12)}…); set WAYBILL_RPC_URL to check`);
  }
  return ok;
}

async function verifyChain(data: { receipts: Record<string, any>[] }): Promise<boolean> {
  const receipts = data.receipts;
  let ok = true;
  let prev = receiptMod.ZERO_HASH;
  for (let i = 0; i < receipts.length; i++) {
    const r = receipts[i];
    ok = (await verifyReceipt(r)) && ok;
    ok = check(`  link seq=${i}`, r.seq === i && r.prev_hash === prev) && ok;
    prev = r.hash;
  }
  console.log(`\nchain: ${receipts.length} receipts, ${ok ? "VALID" : "INVALID"}`);
  return ok;
}

function readJson(path: string): any {
  return JSON.parse(readFileSync(path, "utf8"));
}

async function main(argv: string[]): Promise<number> {
  const cmd = argv[0];
  if (!cmd) {
    console.log(DOC);
    return 2;
  }

  if (cmd === "keygen") {
    const acct = Wallet.createRandom();
    console.log(`WAYBILL_SIGNER_KEY=${acct.privateKey}`);
    console.log(`# address: ${acct.address}`);
    return 0;
  }

  if (cmd === "receipt") {
    const rcpt = readJson(argv[1]);
    const pi = argv.indexOf("--prompt");
    const ai = argv.indexOf("--answer");
    const prompt = pi >= 0 ? argv[pi + 1] : undefined;
    const answer = ai >= 0 ? argv[ai + 1] : undefined;
    return (await verifyReceipt(rcpt, prompt, answer)) ? 0 : 1;
  }

  if (cmd === "chain") {
    return (await verifyChain(readJson(argv[1]))) ? 0 : 1;
  }

  console.log(`unknown command: ${cmd}\n${DOC}`);
  return 2;
}

main(process.argv.slice(2)).then((code) => process.exit(code));
