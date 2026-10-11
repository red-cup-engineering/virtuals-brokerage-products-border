#!/usr/bin/env node
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { createSemanticRecordJournal } from "@red-cup-engineering/semiotic-eavt-services-section/record-semantic-record";
import {
  requireVirtualsProductionGate,
  startVirtualsLiteProduction,
  VIRTUALS_PRODUCTION_PRICE,
} from "../src/virtuals-lite-production.mjs";
import { YANAGI_OPERATOR_WALLET } from "../src/virtuals-lite-commercial-pilot.mjs";

const AUTH_ORIGIN = "https://acpx.virtuals.io";
const STATE_ROOT = resolve(process.argv[2] ?? "data/runtime/virtuals-production");
const EVENT_JOURNAL = createSemanticRecordJournal({ root: STATE_ROOT, objectKind: "blockchain-trashpanda.virtuals-production-event" });
const WAIT_MS = 5_000;
const DEADLINE_MS = 5 * 60_000;

async function json(response, label) {
  const value = await response.json();
  if (!response.ok) throw new Error(`${label} failed with HTTP ${response.status}`);
  return value?.data ?? value;
}

function record(event) {
  const recordedAt = new Date().toISOString();
  EVENT_JOURNAL.record({ category: "virtuals-production.event", recordedAt, record: { ...event, recordedAt }, told: { for: true, against: false } });
  process.stdout.write(`${JSON.stringify(event)}\n`);
}

async function main() {
  requireVirtualsProductionGate();
  mkdirSync(STATE_ROOT, { recursive: true, mode: 0o700 });
  const auth = await json(await fetch(`${AUTH_ORIGIN}/api/auth/lite/auth-url`, { redirect: "error" }), "Virtuals login URL");
  if (typeof auth?.authUrl !== "string" || typeof auth?.requestId !== "string") throw new Error("Virtuals returned a malformed login request");
  process.stdout.write(`${JSON.stringify({ type: "virtuals-login-required", url: auth.authUrl, expiresInSeconds: DEADLINE_MS / 1000 })}\n`);

  const deadline = Date.now() + DEADLINE_MS;
  let sessionToken;
  while (Date.now() < deadline) {
    await new Promise((accept) => setTimeout(accept, WAIT_MS));
    try {
      const status = await json(await fetch(`${AUTH_ORIGIN}/api/auth/lite/auth-status?requestId=${encodeURIComponent(auth.requestId)}`, { redirect: "error" }), "Virtuals login status");
      if (typeof status?.token === "string" && status.token.length > 0) { sessionToken = status.token; break; }
    } catch {
      // The exact authorization request remains pollable only until its bounded deadline.
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

  const service = await startVirtualsLiteProduction({ apiKey: key.apiKey, stateRoot: STATE_ROOT, onEvent: async (event) => record(event) });
  record({
    type: "virtuals-production-serving",
    agent: "Yanagi",
    performer: "urn:ame:blockchain-trashpanda",
    operatorWallet: service.guard.operatorWallet,
    offering: "pre_sign_transaction_policy_conformance",
    price: `${VIRTUALS_PRODUCTION_PRICE} USDC`,
    requiredFunds: false,
    publication: service.publication.disposition,
    credentialPersistence: "memory-only",
  });
}

main().catch((error) => {
  process.stderr.write(`${JSON.stringify({ type: "virtuals-production-fatal", reason: error instanceof Error ? error.message : String(error) })}\n`);
  process.exitCode = 1;
});
