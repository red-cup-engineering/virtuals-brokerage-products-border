import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  createVirtualsLiteApiClient,
  createVirtualsLitePilotJobHandler,
  startVirtualsLiteCommercialPilot,
  ensureVirtualsLitePilotOffering,
  VIRTUALS_LITE_API_ORIGIN,
  VIRTUALS_LITE_PILOT_OFFERING,
  YANAGI_OPERATOR_WALLET,
} from "../src/virtuals-lite-commercial-pilot.mjs";
import { createVirtualsCommercialPilotGuard, PILOT_OFFERING_NAME } from "../src/virtuals-commercial-pilot-guard.mjs";

const HASH = `0x${"ab".repeat(32)}`;

function request() {
  return {
    type: "BasePreSignConformanceRequest",
    version: 1,
    transaction: {
      type: "UnsignedBaseTransaction",
      chainId: 8453,
      sender: YANAGI_OPERATOR_WALLET,
      to: "0x2222222222222222222222222222222222222222",
      valueWei: "0",
      data: "0x",
      gasLimit: "100000",
      nonce: "1",
    },
    policy: { type: "BasePreSignPolicy", version: 1, clauses: [{ id: "base-only", type: "ChainIdEquals", chainId: 8453 }] },
    anchor: { type: "ImmutableBaseBlockAnchor", chainId: 8453, blockNumber: "1", blockHash: HASH },
    evidence: [],
    receiptProfile: "full-v1",
  };
}

function event(id, phase, input = request()) {
  return {
    id,
    phase,
    clientAddress: "0x3333333333333333333333333333333333333333",
    providerAddress: YANAGI_OPERATOR_WALLET,
    evaluatorAddress: "0x4444444444444444444444444444444444444444",
    price: 0.01,
    memoToSign: 7,
    context: {},
    memos: [{ id: 7, nextPhase: 1, content: JSON.stringify({ name: PILOT_OFFERING_NAME, priceType: "fixed", requirement: { request: input } }) }],
  };
}

async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "yanagi-lite-pilot-"));
  const stateRoot = join(directory, "state");
  mkdirSync(stateRoot, { mode: 0o700 });
  const guard = await createVirtualsCommercialPilotGuard({ operatorWalletAddress: YANAGI_OPERATOR_WALLET, stateRoot, now: () => "2026-07-22T12:00:00.000Z" });
  const calls = [];
  const client = {
    async me() { return { data: { name: "Yanagi", walletAddress: YANAGI_OPERATOR_WALLET, jobs: [] } }; },
    async publishOffering(payload) { calls.push(["publish", payload]); },
    async accept(id, payload) { calls.push(["accept", id, payload]); },
    async requestPayment(id, payload) { calls.push(["request-payment", id, payload]); },
    async deliver(id, payload) { calls.push(["deliver", id, payload]); },
    async delistOffering(name) { calls.push(["delist", name]); },
  };
  return { guard, client, calls };
}

test("Lite API client places its credential only on exact official ACP requests", async () => {
  const seen = [];
  const apiKey = "yanagi-test-api-key-which-is-not-production";
  const client = createVirtualsLiteApiClient({
    apiKey,
    fetchImpl: async (url, init) => {
      seen.push({ url, init });
      return new Response(JSON.stringify({ data: { ok: true } }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });
  await client.me();
  await client.accept(42, { accept: true });
  assert.equal(seen[0].url, `${VIRTUALS_LITE_API_ORIGIN}/acp/me`);
  assert.equal(seen[0].init.headers["x-api-key"], apiKey);
  assert.equal(seen[1].url, `${VIRTUALS_LITE_API_ORIGIN}/acp/providers/jobs/42/accept`);
  assert.throws(() => createVirtualsLiteApiClient({ apiKey, apiOrigin: "https://example.invalid" }), /non-official/u);
});

test("publishes only the exact 0.01 USDC no-funds pilot offering", async () => {
  const { client, guard, calls } = await fixture();
  const result = await ensureVirtualsLitePilotOffering({ client, guard });
  assert.equal(result.disposition, "published");
  assert.deepEqual(calls, [["publish", VIRTUALS_LITE_PILOT_OFFERING]]);
  assert.equal(VIRTUALS_LITE_PILOT_OFFERING.priceV2.value, 0.01);
  assert.equal(VIRTUALS_LITE_PILOT_OFFERING.requiredFunds, false);
});

test("claims, accepts, charges, delivers, and delists one exact service-only job", async () => {
  const { client, guard, calls } = await fixture();
  let stops = 0;
  const events = [];
  const handle = createVirtualsLitePilotJobHandler({
    client,
    guard,
    stop: async () => { stops += 1; },
    onEvent: async (value) => events.push(value),
  });
  const admitted = await handle(event(42, 0));
  assert.equal(admitted.disposition, "payment-requested");
  assert.equal(calls[0][0], "accept");
  assert.equal(calls[1][0], "request-payment");
  assert.equal(Object.hasOwn(calls[1][2], "payableDetail"), false);

  const delivered = await handle(event(42, 2));
  assert.equal(delivered.disposition, "delivered-and-delisted");
  assert.equal(calls[2][0], "deliver");
  assert.equal(Object.hasOwn(calls[2][2], "payableDetail"), false);
  assert.equal(JSON.parse(calls[2][2].deliverable).verdict, "PASS");
  assert.deepEqual(calls[3], ["delist", PILOT_OFFERING_NAME]);
  assert.equal(stops, 1);
  assert.equal(events.at(-1).type, "pilot-delivered-and-delisted");
});

test("refuses a second job and a fund-bearing or wrong-price envelope before API effects", async () => {
  const { client, guard, calls } = await fixture();
  const handle = createVirtualsLitePilotJobHandler({ client, guard });
  assert.equal((await handle(event(42, 0))).disposition, "payment-requested");
  const initialEffects = calls.length;
  assert.equal((await handle(event(43, 0))).disposition, "refused");
  const wrongPrice = event(44, 0);
  wrongPrice.price = 1;
  assert.equal((await handle(wrongPrice)).disposition, "refused");
  assert.equal(calls.length, initialEffects);
});

test("the started listener remains live until its explicit bounded stop", async () => {
  const directory = mkdtempSync(join(tmpdir(), "yanagi-lite-listener-"));
  let disconnects = 0;
  const socket = { on() {}, disconnect() { disconnects += 1; } };
  const pilot = await startVirtualsLiteCommercialPilot({
    apiKey: "yanagi-test-api-key-which-is-not-production",
    stateRoot: join(directory, "state"),
    ioFactory: () => socket,
    fetchImpl: async () => new Response(JSON.stringify({ data: {
      name: "Yanagi", walletAddress: YANAGI_OPERATOR_WALLET,
      jobs: [{ ...VIRTUALS_LITE_PILOT_OFFERING }],
    } }), { status: 200, headers: { "content-type": "application/json" } }),
  });
  let settled = false;
  void pilot.completion.then(() => { settled = true; });
  await Promise.resolve();
  assert.equal(settled, false);
  await pilot.stop();
  await pilot.completion;
  assert.equal(disconnects, 1);
});
