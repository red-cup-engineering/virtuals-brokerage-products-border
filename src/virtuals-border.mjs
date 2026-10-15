import { semanticIdOf } from "@red-cup-engineering/computer-data-engineering-services-section/semiotic-expression-notation/semantic-content-identity";
import { canonicalJson as canonical } from "@red-cup-engineering/json-services-section/canonical-json";
const semanticId = semanticIdOf("brokerage.virtuals-products-border.record");

const identify = (body) => ({ id: semanticId(body), ...body });
const CREDENTIAL = /^(authorization|api[-_]?key|api[-_]?secret|secret|token|access[-_]?token|refresh[-_]?token|private[-_]?key|mnemonic|password)$/iu;
function rejectCredentials(value, seen = new Set()) { if (!value || typeof value !== "object" || seen.has(value)) return; seen.add(value); for (const [key, member] of Object.entries(value)) { if (CREDENTIAL.test(key)) throw new TypeError("credential-bearing-virtuals-job-refused"); rejectCredentials(member, seen); } }
export const VIRTUALS_PRODUCTS = Object.freeze({
  "issuer-evidence-packet": "0.25", "aggressive-alpha-research-packet": "1.00", "paper-portfolio-and-order-intents": "2.00",
  "obsmetrologia-blk-topological-accumulation": "3.00", "account-normalization-and-reconciliation": "0.50", "venue-adapter-read": "0.01", "execution-transport": "0.02",
});
export function formVirtualsBrokerageOffering({ operator, operatorWallet, product, publishedAt }) {
  if (!VIRTUALS_PRODUCTS[product] || !/^0x[0-9a-fA-F]{40}$/u.test(operatorWallet ?? "") || !Number.isFinite(Date.parse(publishedAt))) throw new TypeError("virtuals-offering-invalid");
  return Object.freeze(identify({ type: "VirtualsBrokerageServiceOffering", version: 1, operator: String(operator), operatorWallet: operatorWallet.toLowerCase(),
    product, priceUsdc: VIRTUALS_PRODUCTS[product], serviceOnly: true, buyerFundCustody: false, brokerageCredentialCustody: false, publishedAt }));
}
const providerAvailable = (provider) => typeof provider === "function" && typeof provider.preflight === "function"
  && typeof provider.originatingActor === "string" && typeof provider.externalEvidence === "function";
export function createVirtualsBrokerageJobHandler({ providers, marketClient, recordDelivery, witness = async (value) => value }) {
  if (typeof marketClient?.acceptJob !== "function" || typeof marketClient?.deliverJob !== "function" || typeof recordDelivery !== "function") throw new TypeError("virtuals-market-client-and-independent-books-required");
  return async function handle({ offering, job }) {
    rejectCredentials(job?.requirement);
    if (offering?.type !== "VirtualsBrokerageServiceOffering" || job?.product !== offering.product || String(job?.priceUsdc) !== offering.priceUsdc
      || job?.serviceOnly !== true || job?.settlement?.status !== "funded" || !job?.settlement?.reference || !job?.id) throw new TypeError("virtuals-job-does-not-match-offering");
    const provider = providers?.[offering.product]; if (!providerAvailable(provider)) throw new TypeError("virtuals-product-provider-unavailable");
    await provider.preflight(job.requirement);
    const acceptance = await marketClient.acceptJob({ jobId: String(job.id), offering: offering.id }); if (acceptance?.accepted !== true) throw new TypeError("virtuals-job-acceptance-refused");
    const output = await provider(job.requirement);
    const recorded = await recordDelivery({ originatingActor: provider.originatingActor, inputs: [job.requirement], output,
      externalEvidence: provider.externalEvidence(job.requirement, output) });
    const delivery = await marketClient.deliverJob({ jobId: String(job.id), output, witness: recorded.witness ?? recorded }); if (delivery?.completed !== true || !delivery?.receipt) throw new TypeError("virtuals-delivery-receipt-invalid");
    const body = { type: "VirtualsBrokerageProductReceipt", version: 1, offering: offering.id, jobId: String(job.id), product: offering.product,
      priceUsdc: offering.priceUsdc, fundingReference: job.settlement.reference, deliveryReceipt: delivery.receipt, output: output?.id ?? identify(output).id,
      independentWitness: (recorded.witness ?? recorded).id, serviceOnly: true, buyerFundCustody: false, brokerageCredentialsUsedByBorder: false, crossMarketReceiptSubstitution: false };
    return witness(Object.freeze(identify(body)));
  };
}
