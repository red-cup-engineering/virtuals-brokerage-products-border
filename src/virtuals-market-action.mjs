import { evaluateMarketActionAdmission } from "@red-cup-engineering/blockchain-trashpanda-services-section/market-action-admission";

export const VIRTUALS_MARKET_ACTION_OFFERING_NAME = "market_action_admission_v1";
export const VIRTUALS_MARKET_ACTION_PRICE = "0.05";

export const VIRTUALS_MARKET_ACTION_OFFERING = Object.freeze({
  name: VIRTUALS_MARKET_ACTION_OFFERING_NAME,
  description: "Deterministically evaluate one proposed market action against the buyer's exact policy and immutable evidence snapshot. Returns a replayable ADMIT, REFUSE, or ESCALATE receipt. This is policy admission, not market prediction or trade execution; no keys, custody, signing, order placement, or broadcast authority are accepted.",
  priceV2: Object.freeze({ type: "fixed", value: 0.05 }),
  slaMinutes: 5,
  requiredFunds: false,
  requirement: Object.freeze({
    type: "object",
    additionalProperties: false,
    properties: Object.freeze({
      request: Object.freeze({
        type: "object",
        description: "One exact MarketActionAdmissionRequest v1; canonical shape, public-evidence references, authority refusal, and resource limits apply.",
      }),
    }),
    required: Object.freeze(["request"]),
  }),
  deliverable: "MarketActionAdmissionReceipt v1 JSON",
});

export function evaluateVirtualsMarketActionRequirement(requirement) {
  if (requirement === null || typeof requirement !== "object" || Array.isArray(requirement)
      || Object.keys(requirement).length !== 1 || !Object.hasOwn(requirement, "request")) {
    throw new TypeError("Virtuals market-action requirement must contain exactly one request");
  }
  return evaluateMarketActionAdmission(requirement.request);
}
