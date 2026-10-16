import { syntheticAuthorizationPath } from "./fixtures/synthetic-pilot-authorization.mjs";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  ACP_SUBMIT_SELECTOR,
  ACP_SET_BUDGET_SELECTOR,
  BASE_ACP_CONTRACT,
  createVirtualsCommercialPilotGuard,
  PILOT_OFFERING_NAME,
} from "../src/virtuals-commercial-pilot-guard.mjs";

const OPERATOR = "0x1111111111111111111111111111111111111111";
const NOW = "2026-07-22T12:00:00.000Z";
const OFFERING = { name: PILOT_OFFERING_NAME, jobFee: "0.01", jobFeeType: "fixed", requiredFunds: false };

async function fixture(operatorWalletAddress = OPERATOR) {
  const directory = mkdtempSync(join(tmpdir(), "yanagi-virtuals-pilot-"));
  const stateRoot = join(directory, "state");
  mkdirSync(stateRoot, { mode: 0o700 });
  return createVirtualsCommercialPilotGuard({ authorizationPath: syntheticAuthorizationPath(directory), operatorWalletAddress, stateRoot, now: () => NOW });
}

function submitCall(jobId) {
  const encodedJobId = BigInt(jobId).toString(16).padStart(64, "0");
  return { to: BASE_ACP_CONTRACT, data: `${ACP_SUBMIT_SELECTOR}${encodedJobId}${"00".repeat(64)}`, value: 0n };
}

function setBudgetCall(jobId, amount = 10_000n) {
  const encodedJobId = BigInt(jobId).toString(16).padStart(64, "0");
  const encodedAmount = BigInt(amount).toString(16).padStart(64, "0");
  return { to: BASE_ACP_CONTRACT, data: `${ACP_SET_BUDGET_SELECTOR}${encodedJobId}${encodedAmount}${"00".repeat(32)}`, value: 0n };
}

function delegate(overrides = {}) {
  return {
    sent: [],
    async getAddress() { return OPERATOR; },
    async getSupportedChainIds() { return [8453]; },
    async getNetworkContext() { return { network: "base-mainnet" }; },
    async sendCalls(chainId, calls) { this.sent.push({ chainId, calls }); return "0xfeed"; },
    async getTransactionReceipt() { return { status: "success" }; },
    async readContract() { return 1n; },
    async getLogs() { return []; },
    async getBlockNumber() { return 1n; },
    ...overrides,
  };
}

test("admits only one exact Base service-only 0.01 USDC job", async () => {
  const guard = await fixture();
  const claim = await guard.admitJob({ jobId: "42", chainId: 8453, offering: OFFERING });
  assert.equal(claim.jobId, "42");
  assert.equal((await guard.admitJob({ jobId: 42n, chainId: 8453, offering: OFFERING })).jobId, "42");
  await assert.rejects(guard.admitJob({ jobId: "43", chainId: 8453, offering: OFFERING }), /different job/u);

  const wrongPrice = await fixture();
  await assert.rejects(wrongPrice.admitJob({ jobId: "1", chainId: 8453, offering: { ...OFFERING, jobFee: "0.02" } }), /0.01 USDC service-only/u);
  await assert.rejects(wrongPrice.admitJob({ jobId: "1", chainId: 8453, offering: { ...OFFERING, requiredFunds: true } }), /service-only/u);
  await assert.rejects(wrongPrice.admitJob({ jobId: "1", chainId: 1, offering: OFFERING }), /Base chain 8453/u);
  const officialNumericFee = await fixture();
  assert.equal((await officialNumericFee.admitJob({ jobId: "9", chainId: 8453, offering: { ...OFFERING, jobFee: 0.01 } })).offering.jobFee, "0.01");
});

test("refuses an operator configured as forbidden", async () => {
  const directory = mkdtempSync(join(tmpdir(), "yanagi-virtuals-pilot-forbidden-"));
  const stateRoot = join(directory, "state");
  mkdirSync(stateRoot, { mode: 0o700 });
  await assert.rejects(
    createVirtualsCommercialPilotGuard({ authorizationPath: syntheticAuthorizationPath(directory), operatorWalletAddress: OPERATOR, stateRoot, forbiddenOperatorWallets: [OPERATOR] }),
    /operator wallet is forbidden/u,
  );
});


test("allows one exact-budget phase and one submit phase for the claimed job, then exhausts each", async () => {
  const guard = await fixture();
  await guard.admitJob({ jobId: "42", chainId: 8453, offering: OFFERING });
  const inner = delegate();
  const adapter = guard.wrapAdapter(inner);
  assert.equal(await adapter.getAddress(), OPERATOR);
  assert.equal(await adapter.sendCalls(8453, [setBudgetCall(42)]), "0xfeed");
  await assert.rejects(adapter.sendCalls(8453, [setBudgetCall(42)]), /set-budget attempt is already exhausted/u);
  assert.equal(await adapter.sendCalls(8453, [submitCall(42)]), "0xfeed");
  assert.equal(inner.sent.length, 2);
  await assert.rejects(adapter.sendCalls(8453, [submitCall(42)]), /submit attempt is already exhausted/u);
  await assert.rejects(adapter.sendTransaction(8453, submitCall(42)), /fund-transfer paths/u);
  await assert.rejects(adapter.signMessage(8453, "anything"), /arbitrary message signing/u);
});

test("refuses wrong job, selector, target, value, chain, and batching before delegation", async () => {
  for (const mutate of [
    (call) => submitCall(43),
    (call) => ({ ...call, data: `0xd2e13f50${call.data.slice(10)}` }),
    (call) => ({ ...call, to: "0x3333333333333333333333333333333333333333" }),
    (call) => ({ ...call, value: 1n }),
  ]) {
    const guard = await fixture();
    await guard.admitJob({ jobId: "42", chainId: 8453, offering: OFFERING });
    const inner = delegate();
    const adapter = guard.wrapAdapter(inner);
    await assert.rejects(adapter.sendCalls(8453, [mutate(submitCall(42))]));
    assert.equal(inner.sent.length, 0);
  }
  const guard = await fixture();
  await guard.admitJob({ jobId: "42", chainId: 8453, offering: OFFERING });
  const adapter = guard.wrapAdapter(delegate());
  await assert.rejects(adapter.sendCalls(1, [submitCall(42)]), /Base chain 8453/u);
  await assert.rejects(adapter.sendCalls(8453, [submitCall(42), submitCall(42)]), /exactly one/u);
});

test("refuses any service budget other than exactly 10000 USDC base units", async () => {
  const guard = await fixture();
  await guard.admitJob({ jobId: "42", chainId: 8453, offering: OFFERING });
  const inner = delegate();
  const adapter = guard.wrapAdapter(inner);
  await assert.rejects(adapter.sendCalls(8453, [setBudgetCall(42, 9_999n)]), /exactly 0.01 USDC/u);
  await assert.rejects(adapter.sendCalls(8453, [setBudgetCall(42, 10_001n)]), /exactly 0.01 USDC/u);
  assert.equal(inner.sent.length, 0);
});

test("refuses a delegate whose wallet is not the admitted operator", async () => {
  const guard = await fixture();
  const adapter = guard.wrapAdapter(delegate({ async getAddress() { return "0x4444444444444444444444444444444444444444"; } }));
  await assert.rejects(adapter.getAddress(), /does not match/u);
});
