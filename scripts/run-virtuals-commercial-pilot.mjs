#!/usr/bin/env node
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import {
  startVirtualsLiteCommercialPilot,
  YANAGI_OPERATOR_WALLET,
} from "../src/virtuals-lite-commercial-pilot.mjs";

import { readVirtualsPilotAuthorization } from "../src/virtuals-commercial-pilot-guard.mjs";

const AUTH_ORIGIN = "https://acpx.virtuals.io";
const STATE_ROOT = resolve(process.argv[2] ?? "data/runtime/virtuals-commercial-pilot");
const WAIT_MS = 5_000;
const DEADLINE_MS = 5 * 60_000;

async function json(response, label) {
  const value = await response.json();
  if (!response.ok) throw new Error(`${label} failed with HTTP ${response.status}`);
  return value?.data ?? value;
}

async function main() {
  const authorizationPath = process.argv[3];
  await readVirtualsPilotAuthorization(authorizationPath);
  mkdirSync(STATE_ROOT, { recursive: true, mode: 0o700 });
  const auth = await json(await fetch(`${AUTH_ORIGIN}/api/auth/lite/auth-url`, { redirect: "error" }), "Virtuals login URL");
  if (typeof auth?.authUrl !== "string" || typeof auth?.requestId !== "string") throw new Error("Virtuals returned a malformed login request");
  process.stdout.write(`${JSON.stringify({ type: "virtuals-login-required", url: auth.authUrl, expiresInSeconds: DEADLINE_MS / 1000 })}\n`);

  const deadline = Date.now() + DEADLINE_MS;
  let sessionToken;
  while (Date.now() < deadline) {
    await new Promise((resolveWait) => setTimeout(resolveWait, WAIT_MS));
    try {
      const status = await json(await fetch(`${AUTH_ORIGIN}/api/auth/lite/auth-status?requestId=${encodeURIComponent(auth.requestId)}`, { redirect: "error" }), "Virtuals login status");
      if (typeof status?.token === "string" && status.token.length > 0) {
        sessionToken = status.token;
        break;
      }
    } catch {
      // Authentication status is intentionally polled until the bounded deadline.
    }
  }
  if (!sessionToken) throw new Error("Virtuals login approval timed out");

  const key = await json(await fetch(`${AUTH_ORIGIN}/api/agents/lite/${YANAGI_OPERATOR_WALLET}/regenerate-api`, {
    method: "POST",
    headers: { authorization: `Bearer ${sessionToken}`, "content-type": "application/json" },
    redirect: "error",
  }), "Yanagi API-key regeneration");
  sessionToken = undefined;
  if (typeof key?.apiKey !== "string" || key.apiKey.length < 16) throw new Error("Virtuals returned a malformed Yanagi API key");

  const pilot = await startVirtualsLiteCommercialPilot({
    apiKey: key.apiKey,
    stateRoot: STATE_ROOT,
    authorizationPath,
    onEvent: async (event) => process.stdout.write(`${JSON.stringify(event)}\n`),
  });
  process.stdout.write(`${JSON.stringify({
    type: "virtuals-pilot-serving",
    operatorWallet: pilot.guard.operatorWallet,
    offering: "pre_sign_transaction_policy_conformance",
    price: "0.01 USDC",
    publication: pilot.publication.disposition,
    credentialPersistence: "memory-only",
  })}\n`);
  const remaining = Math.max(0, deadline - Date.now());
  const timeout = setTimeout(() => { void pilot.stop(); }, remaining);
  await pilot.completion;
  clearTimeout(timeout);
}

main().catch((error) => {
  process.stderr.write(`${JSON.stringify({ type: "virtuals-pilot-fatal", reason: error instanceof Error ? error.message : String(error) })}\n`);
  process.exitCode = 1;
});
