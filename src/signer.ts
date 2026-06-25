/**
 * Enclave-bound signing key — KMS-derived wallet (closes the key-custody gap).
 *
 * On EigenCompute the KMS injects a BIP39 mnemonic at process.env.MNEMONIC,
 * bound to ECLOUD_APP_ID and the attested image, decryptable ONLY inside this
 * enclave and stable across `ecloud compute app upgrade`. We derive the
 * orchestrator's wallet from it (ethers.Wallet.fromPhrase) — the operator never
 * chose or saw the key, so a valid signature provably came from the genuine
 * attested image running in a real TEE.
 *
 * This is the Taiko lesson the launch piece opens with: TEE attestation is
 * worthless without key custody. Custody lives with the KMS, not with us — we
 * never hold or set a key in the enclave path.
 *
 * Local dev: MNEMONIC is empty, so fall back to WAYBILL_SIGNER_KEY (a raw key
 * from `npm run verify keygen`). That fallback never runs inside the enclave.
 *
 * Verifying the signer IS the genuine KMS wallet (the "verifiable KMS" step):
 * recover the address from a receipt, then confirm it equals the app's *Derived
 * Address* on the EigenCloud Verifiability Dashboard for the on-chain image
 * digest. signer == derived address + reproduced image hash ⇒ trust, with no
 * trust in the operator. See README.
 *
 * Signatures are EIP-191 (personal_sign) over the 32 raw bytes of the receipt
 * hash — sign/recover operate on the bytes, not the hex text.
 */
import { Wallet, HDNodeWallet, verifyMessage, getBytes } from "ethers";

type Signer = Wallet | HDNodeWallet;
let cached: Signer | undefined;

export function loadAccount(): Signer {
  if (cached) return cached;

  const mnemonic = process.env.MNEMONIC?.trim();
  if (mnemonic) return (cached = Wallet.fromPhrase(mnemonic)); // KMS-injected, enclave-bound

  const key = process.env.WAYBILL_SIGNER_KEY?.trim();
  if (key) return (cached = new Wallet(key)); // local dev / explicit key

  throw new Error(
    "No signing key. On EigenCompute the KMS injects MNEMONIC automatically; " +
      "for local dev set WAYBILL_SIGNER_KEY (`npm run verify keygen`) or a MNEMONIC.",
  );
}

/** True when the wallet is derived from the KMS-injected mnemonic (enclave path). */
export function isKmsDerived(): boolean {
  return Boolean(process.env.MNEMONIC?.trim());
}

const hashBytes = (receiptHashHex: string) =>
  getBytes(receiptHashHex.startsWith("0x") ? receiptHashHex : "0x" + receiptHashHex);

export function address(): string {
  return loadAccount().address;
}

/** Sign a receipt hash; returns 0x-prefixed signature. */
export function sign(receiptHashHex: string): Promise<string> {
  return loadAccount().signMessage(hashBytes(receiptHashHex));
}

/** Recover the signer address from a receipt hash + signature. */
export function recover(receiptHashHex: string, signature: string): string {
  return verifyMessage(hashBytes(receiptHashHex), signature);
}
