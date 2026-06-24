/**
 * Enclave-bound signing key.
 *
 * On EigenCompute, WAYBILL_SIGNER_KEY is a sealed secret — set via
 * `ecloud compute app env set` and decryptable only inside the attested TEE. So
 * a valid signature traces to a key that exists only in the genuine enclave
 * running the on-chain-recorded image.
 *
 * ponytail: a sealed-secret key, not a true enclave-DERIVED wallet. Upgrade
 * path: swap loadAccount() for EigenCompute's enclave key API when exposed, so
 * the key provably never existed outside the TD. Named so we don't overclaim.
 *
 * Signatures are EIP-191 (personal_sign) over the 32 raw bytes of the receipt
 * hash — sign/recover operate on the bytes, not the hex text.
 */
import { Wallet, verifyMessage, getBytes } from "ethers";

export function loadAccount(): Wallet {
  const KEY = process.env.WAYBILL_SIGNER_KEY;
  if (!KEY) {
    throw new Error(
      "WAYBILL_SIGNER_KEY not set. Generate one with " +
        "`npm run verify keygen` and set it as a sealed secret.",
    );
  }
  return new Wallet(KEY);
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
