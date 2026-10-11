import assert from "node:assert/strict";
import test from "node:test";

import { formIssuerEvidencePacket, validateIssuerEvidenceRequest } from "../../../scripts/evidence-packet.mjs";
import { createVirtualsBrokerageJobHandler, formVirtualsBrokerageOffering } from "../src/virtuals-border.mjs";

test("the Virtuals border delivers an issuer packet from its narrow provider", async () => {
  const requirement = {
    ticker: "BLK", issuer: "BlackRock", asOf: "2099-01-01T00:00:00.000Z",
    sources: [{ uri: "https://example.test/filing", observedAt: "2099-01-01T00:00:00.000Z", digest: "ni:///sha-256;AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" }],
    claims: [{ statement: "A bounded test claim.", sourceDigests: ["ni:///sha-256;AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"] }],
  };
  const provider = async (input) => formIssuerEvidencePacket(input);
  Object.defineProperties(provider, {
    preflight: { value: async (input) => validateIssuerEvidenceRequest(input) },
    originatingActor: { value: "urn:ame:issuer-research-media-service" },
    externalEvidence: { value: (input) => input.sources },
  });
  const offering = formVirtualsBrokerageOffering({
    operator: "urn:operator:test", operatorWallet: "0x1111111111111111111111111111111111111111",
    product: "issuer-evidence-packet", publishedAt: "2099-01-01T00:00:00.000Z",
  });
  const handler = createVirtualsBrokerageJobHandler({
    providers: { "issuer-evidence-packet": provider },
    marketClient: {
      acceptJob: async () => ({ accepted: true }),
      deliverJob: async () => ({ completed: true, receipt: "virtuals:delivery:test" }),
    },
    recordDelivery: async () => ({ witness: { id: "witness:test" } }),
  });
  const receipt = await handler({ offering, job: {
    id: "1", product: offering.product, priceUsdc: offering.priceUsdc, serviceOnly: true,
    settlement: { status: "funded", reference: "funding:test" }, requirement,
  } });
  assert.equal(receipt.output, formIssuerEvidencePacket(requirement).id);
  assert.equal(receipt.independentWitness, "witness:test");
  assert.equal(receipt.brokerageCredentialsUsedByBorder, false);
});
