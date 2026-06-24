/**
 * TEE attestation snapshot — the EigenCompute angle.
 *
 * At deploy time EigenCompute injects its KMS signing public key into the
 * enclave. Its presence + hash proves the boot ran through the attested KMS
 * pipeline (genuine TDX enclave running the on-chain-recorded image). Locally
 * the file is absent, so we report source="local-dev" honestly.
 *
 * The authoritative check is still the verify dashboard
 * (verify-sepolia.eigencloud.xyz/app/<APP_ID>) — this endpoint just surfaces
 * what the running instance can see about itself.
 *
 * ponytail: read the KMS pem if present, else fall back. No SDK call needed.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

const KMS_PEM_PATH = "/usr/local/bin/kms-signing-public-key.pem";

export interface Attestation {
  app_id: string;
  image_digest: string;
  build_time: string;
  attestation_hash: string;
  verify_url: string | null;
  source: "tee" | "local-dev";
}

export function readAttestation(): Attestation {
  const appId = process.env.ECLOUD_APP_ID ?? "local";
  const base = {
    app_id: appId,
    image_digest: process.env.IMAGE_DIGEST ?? "unknown",
    build_time: process.env.BUILD_TIME ?? "unknown",
    verify_url:
      appId !== "local" ? `https://verify-sepolia.eigencloud.xyz/app/${appId}` : null,
  };

  if (existsSync(KMS_PEM_PATH)) {
    const pemHash = createHash("sha256").update(readFileSync(KMS_PEM_PATH)).digest("hex");
    return { ...base, attestation_hash: `sha256:${pemHash}`, source: "tee" };
  }
  return { ...base, attestation_hash: "sha256:local-dev", source: "local-dev" };
}
