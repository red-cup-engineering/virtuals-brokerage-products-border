import { syntheticAuthorizationPath } from "./fixtures/synthetic-pilot-authorization.mjs";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createVirtualsCommercialPilotGuard, PILOT_OFFERING_NAME } from "../src/virtuals-commercial-pilot-guard.mjs";
import { createVirtualsPilotEntryHandler } from "../src/virtuals-commercial-pilot-runtime.mjs";

const OPERATOR = "0x1111111111111111111111111111111111111111";
const HASH = `0x${"aa".repeat(32)}`;
const AssetToken = { usdc(amount, chainId) { return { type: "usdc", amount, chainId }; } };

function request() {
  return {
    type: "BasePreSignConformanceRequest",
    version: 1,
    transaction: { type: "UnsignedBaseTransaction", chainId: 8453, sender: OPERATOR, to: "0x2222222222222222222222222222222222222222", valueWei: "0", data: "0x", gasLimit: "100000", nonce: "1" },
    policy: { type: "BasePreSignPolicy", version: 1, clauses: [{ id: "a-chain", type: "ChainIdEquals", chainId: 8453 }] },
    anchor: { type: "ImmutableBaseBlockAnchor", chainId: 8453, blockNumber: "1", blockHash: HASH },
    evidence: [],
    receiptProfile: "full-v1",
  };
}

async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "yanagi-virtuals-runtime-"));
  const stateRoot = join(directory, "state");
  mkdirSync(stateRoot, { mode: 0o700 });
  const guard = await createVirtualsCommercialPilotGuard({ authorizationPath: syntheticAuthorizationPath(directory), operatorWalletAddress: OPERATOR, stateRoot, now: () => "2026-07-22T12:00:00.000Z" });
  const refusals = [];
  const terminals = [];
  const handler = createVirtualsPilotEntryHandler({ guard, AssetToken, onRefusal: async (value) => refusals.push(value), onTerminal: async (value) => terminals.push(value) });
  return { guard, handler, refusals, terminals };
}

function session(jobId = "42") {
  return {
    jobId,
    chainId: 8453,
    roles: ["provider"],
    status: "open",
    job: { description: PILOT_OFFERING_NAME },
    entries: [],
    budgets: [],
    submissions: [],
    async setBudget(value) { this.budgets.push(value); },
    async submit(value) { this.submissions.push(value); },
  };
}

function requirementEntry(value = request()) {
  return { kind: "message", contentType: "requirement", content: JSON.stringify({ request: value }) };
}

test("validates and claims one request before setting exactly 0.01 USDC on Base", async () => {
  const { handler, refusals } = await fixture();
  const active = session();
  const result = await handler(active, requirementEntry());
  assert.deepEqual(result, { disposition: "budget-set", jobId: "42", amount: "0.01", currency: "USDC" });
  assert.deepEqual(active.budgets, [{ type: "usdc", amount: 0.01, chainId: 8453 }]);
  assert.equal(refusals.length, 0);
});

test("funded job submits only the deterministic product receipt with no transfer detail", async () => {
  const { handler } = await fixture();
  const active = session();
  const requirement = requirementEntry();
  active.entries.push(requirement);
  await handler(active, requirement);
  active.status = "funded";
  const result = await handler(active, { kind: "system", event: { type: "job.funded" } });
  assert.equal(result.disposition, "submitted");
  assert.equal(active.submissions.length, 1);
  const receipt = JSON.parse(active.submissions[0]);
  assert.equal(receipt.type, "BasePreSignPolicyConformanceReceipt");
  assert.equal(receipt.verdict, "PASS");
  assert.deepEqual(receipt.forbiddenEffects, { credentials: false, custody: false, signing: false, broadcast: false, stateMutation: false });
});

test("malformed or second-job requirements are refused without budget or product execution", async () => {
  const { handler, refusals } = await fixture();
  const first = session("42");
  await handler(first, requirementEntry());
  const second = session("43");
  const secondResult = await handler(second, requirementEntry());
  assert.equal(secondResult.disposition, "refused");
  assert.equal(second.budgets.length, 0);
  const malformed = session("44");
  const malformedResult = await handler(malformed, { kind: "message", contentType: "requirement", content: "{}" });
  assert.equal(malformedResult.disposition, "refused");
  assert.equal(malformed.budgets.length, 0);
  assert.equal(refusals.length, 2);
});

test("non-Base, non-provider, and other-offering sessions are refused", async () => {
  for (const mutate of [
    (value) => { value.chainId = 1; },
    (value) => { value.roles = ["client"]; },
    (value) => { value.job.description = "anything_else"; },
  ]) {
    const { handler } = await fixture();
    const active = session();
    mutate(active);
    assert.equal((await handler(active, requirementEntry())).disposition, "refused");
    assert.equal(active.budgets.length, 0);
  }
});

test("terminal event is reported for the claimed job", async () => {
  const { handler, terminals } = await fixture();
  const active = session();
  await handler(active, requirementEntry());
  const result = await handler(active, { kind: "system", event: { type: "job.completed" } });
  assert.equal(result.disposition, "terminal");
  assert.deepEqual(terminals, [{ jobId: "42", event: "job.completed" }]);

  const unrelated = session("43");
  const ignored = await handler(unrelated, { kind: "system", event: { type: "job.expired" } });
  assert.equal(ignored.disposition, "ignored");
  assert.equal(terminals.length, 1);
});
