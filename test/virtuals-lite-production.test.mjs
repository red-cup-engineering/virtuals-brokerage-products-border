import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  createVirtualsProductionGuard,
  createVirtualsProductionJobHandler,
  ensureVirtualsProductionOffering,
  VIRTUALS_PRODUCTION_OFFERING,
  VIRTUALS_PRODUCTION_PRICE,
} from "../src/virtuals-lite-production.mjs";
import { PILOT_OFFERING_NAME } from "../src/virtuals-commercial-pilot-guard.mjs";
import { YANAGI_OPERATOR_WALLET } from "../src/virtuals-lite-commercial-pilot.mjs";

function request(nonce = "1") {
  return {
    type: "BasePreSignConformanceRequest", version: 1,
    transaction: { type: "UnsignedBaseTransaction", chainId: 8453, sender: YANAGI_OPERATOR_WALLET, to: "0x2222222222222222222222222222222222222222", valueWei: "0", data: "0x", gasLimit: "100000", nonce },
    policy: { type: "BasePreSignPolicy", version: 1, clauses: [{ id: "base", type: "ChainIdEquals", chainId: 8453 }] },
    anchor: { type: "ImmutableBaseBlockAnchor", chainId: 8453, blockNumber: "1", blockHash: `0x${"ab".repeat(32)}` },
    evidence: [], receiptProfile: "full-v1",
  };
}

function envelope(id, phase, work = request()) {
  return {
    id, phase, providerAddress: YANAGI_OPERATOR_WALLET, price: 0.05, requiredFunds: false, memoToSign: 7,
    memos: [{ id: 7, nextPhase: 1, content: JSON.stringify({ name: PILOT_OFFERING_NAME, priceType: "fixed", requirement: { request: work } }) }],
  };
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "yanagi-production-"));
  const stateRoot = join(root, "state");
  mkdirSync(stateRoot, { mode: 0o700 });
  const guard = createVirtualsProductionGuard({ stateRoot, now: () => "2026-07-22T19:00:00.000Z" });
  const calls = [];
  const client = {
    async me() { return { data: { name: "Yanagi", walletAddress: YANAGI_OPERATOR_WALLET, jobs: [] } }; },
    async publishOffering(value) { calls.push(["publish", value]); },
    async accept(id, value) { calls.push(["accept", id, value]); },
    async requestPayment(id, value) { calls.push(["request-payment", id, value]); },
    async deliver(id, value) { calls.push(["deliver", id, value]); },
  };
  const signerKeysPath = join(root, "signer-keys.json"), pricingPath = join(root, "pricing.json");
  writeFileSync(signerKeysPath, JSON.stringify({ secret: "s", salt: "a", keys: { "pub-1": { nonce: "n", ciphertext: "c" } } }));
  writeFileSync(pricingPath, JSON.stringify({ type: "BlockchainTrashpandaVirtualsCurrentMarketPricingEvidence", admittedGrossPriceUsdc: "0.05", pilotDemandExcluded: true }));
  return { root, stateRoot, guard, client, calls, gateOptions: { signerKeysPath, pricingPath } };
}

test("production publication refuses before an admitted signer keystore", async () => {
  const { guard, client, gateOptions } = fixture();
  assert.equal(VIRTUALS_PRODUCTION_PRICE, "0.05");
  assert.equal(VIRTUALS_PRODUCTION_OFFERING.requiredFunds, false);
  await assert.rejects(ensureVirtualsProductionOffering({ client, guard, gateOptions: { ...gateOptions, signerKeysPath: join(tmpdir(), "missing-signer-keys.json") } }), /signer keystore/u);
});

test("refuses a production operator configured as forbidden", () => {
  const { stateRoot } = fixture();
  assert.throws(
    () => createVirtualsProductionGuard({ stateRoot, operatorWalletAddress: YANAGI_OPERATOR_WALLET, forbiddenOperatorWallets: [YANAGI_OPERATOR_WALLET] }),
    /operator wallet is forbidden/u,
  );
});

test("publishes the admitted 0.05 USDC service-only offering after the gate", async () => {
  const { guard, client, calls, gateOptions } = fixture();
  const result = await ensureVirtualsProductionOffering({ client, guard, gateOptions });
  assert.equal(result.disposition, "published");
  assert.deepEqual(calls, [["publish", VIRTUALS_PRODUCTION_OFFERING]]);
  assert.equal(VIRTUALS_PRODUCTION_OFFERING.priceV2.value, 0.05);
  assert.equal(JSON.parse(readFileSync(guard.publicationPath, "utf8")).priceUsdc, "0.05");
});

test("serves multiple separately claimed production jobs without delisting", async () => {
  const { guard, client, calls } = fixture();
  const events = [];
  const handle = createVirtualsProductionJobHandler({ client, guard, onEvent: async (event) => events.push(event) });
  for (const [id, nonce] of [[42, "1"], [43, "2"]]) {
    const work = request(nonce);
    assert.equal((await handle(envelope(id, 0, work))).disposition, "payment-requested");
    const delivered = await handle(envelope(id, 2, work));
    assert.equal(delivered.disposition, "delivered");
  }
  assert.deepEqual(calls.map(([kind]) => kind), ["accept", "request-payment", "deliver", "accept", "request-payment", "deliver"]);
  assert.equal(calls.some(([kind]) => kind === "delist"), false);
  assert.equal(events.filter(({ type }) => type === "production-job-delivered").length, 2);
});

test("refuses penny-priced, fund-bearing, changed, and duplicate jobs before extra effects", async () => {
  const { guard, client, calls } = fixture();
  const handle = createVirtualsProductionJobHandler({ client, guard });
  const penny = envelope(1, 0); penny.price = 0.01;
  assert.equal((await handle(penny)).disposition, "refused");
  const funded = envelope(2, 0); funded.requiredFunds = true;
  assert.equal((await handle(funded)).disposition, "refused");
  assert.equal((await handle(envelope(3, 0))).disposition, "payment-requested");
  assert.equal((await handle(envelope(3, 0, request("9")))).disposition, "refused");
  assert.equal((await handle(envelope(3, 0))).disposition, "refused");
  assert.equal(calls.length, 2);
});
