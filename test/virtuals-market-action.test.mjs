import assert from "node:assert/strict";
import test from "node:test";

import {
  VIRTUALS_MARKET_ACTION_OFFERING,
  VIRTUALS_MARKET_ACTION_OFFERING_NAME,
  VIRTUALS_MARKET_ACTION_PRICE,
  evaluateVirtualsMarketActionRequirement,
} from "../src/virtuals-market-action.mjs";
import { X402_MARKET_ACTION_SAMPLE_REQUEST } from "@red-cup-engineering/blockchain-trashpanda-services-section/market-action-admission";

test("declares a service-only Virtuals market-action offering", () => {
  assert.equal(VIRTUALS_MARKET_ACTION_OFFERING.name, VIRTUALS_MARKET_ACTION_OFFERING_NAME);
  assert.equal(String(VIRTUALS_MARKET_ACTION_OFFERING.priceV2.value), VIRTUALS_MARKET_ACTION_PRICE);
  assert.equal(VIRTUALS_MARKET_ACTION_OFFERING.requiredFunds, false);
  assert.match(VIRTUALS_MARKET_ACTION_OFFERING.description, /not market prediction or trade execution/u);
  assert.doesNotMatch(JSON.stringify(VIRTUALS_MARKET_ACTION_OFFERING), /privateKey|seedPhrase|YANAGI_WALLET/u);
});

test("adapts the exact same deterministic receipt for a Virtuals broker", () => {
  const receipt = evaluateVirtualsMarketActionRequirement({ request: X402_MARKET_ACTION_SAMPLE_REQUEST });
  assert.equal(receipt.type, "MarketActionAdmissionReceipt");
  assert.equal(receipt.verdict, "ADMIT");
  assert.equal(receipt.forbiddenEffects.orderPlacement, false);
  assert.equal(receipt.forbiddenEffects.signing, false);
});

test("refuses carrier-specific authority and malformed envelopes", () => {
  assert.throws(() => evaluateVirtualsMarketActionRequirement({
    request: X402_MARKET_ACTION_SAMPLE_REQUEST,
    placeOrder: true,
  }), /exactly one request/u);
  const request = structuredClone(X402_MARKET_ACTION_SAMPLE_REQUEST);
  request.credential = "not-a-credential";
  assert.throws(() => evaluateVirtualsMarketActionRequirement({ request }), /forbidden field 'credential'/u);
});
