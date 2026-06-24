/**
 * On-chain anchoring (Sepolia).
 *
 * Why on-chain at all: the anchor is what lets a third party verify the log
 * without trusting you or your cloud. An off-chain log reintroduces the exact
 * trust boundary this project removes.
 *
 * This build anchors EVERY receipt: a 0-value tx from the enclave key to itself
 * with the receipt hash in calldata. No contract to deploy — the tx itself is
 * the immutable, timestamped, signed record. A verifier checks the tx exists,
 * came from the enclave address, and its calldata equals the receipt hash.
 *
 * ponytail: self-tx + calldata, no contract. Each receipt = one tx, serialized
 * by nonce (~one block apart). If you need batching/granularity control, anchor
 * only per-run chain roots via a tiny contract instead. We don't wait for
 * confirmation (return the tx hash immediately); the verifier confirms it later.
 */
import { JsonRpcProvider } from "ethers";

import { loadAccount } from "./signer.js";

const RPC_URL = process.env.WAYBILL_RPC_URL ?? "";

const provider = () => new JsonRpcProvider(RPC_URL);

export function enabled(): boolean {
  return Boolean(RPC_URL);
}

/** Anchor a receipt hash on Sepolia. Returns tx hash, or null if disabled. */
export async function anchor(receiptHashHex: string): Promise<string | null> {
  if (!enabled()) return null; // local/offline mode — logged by caller
  const acct = loadAccount().connect(provider());
  const tx = await acct.sendTransaction({
    to: acct.address,
    value: 0,
    data: "0x" + receiptHashHex,
    gasLimit: 30_000,
  });
  return tx.hash; // broadcast only; not awaiting confirmation
}

/** Confirm an on-chain anchor: tx mined, from the signer, calldata matches. */
export async function verifyAnchor(
  txHash: string,
  receiptHashHex: string,
  expectedSigner: string,
): Promise<boolean> {
  const tx = await provider().getTransaction(txHash);
  if (!tx) return false;
  return (
    tx.data.replace(/^0x/, "").toLowerCase() === receiptHashHex.toLowerCase() &&
    tx.from.toLowerCase() === expectedSigner.toLowerCase()
  );
}
