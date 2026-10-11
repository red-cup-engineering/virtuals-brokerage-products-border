import { resolve } from "node:path";
import { createPolicyBoundPrivyAuthorizationSignFn } from "@red-cup-engineering/ethereum-engineering-services-section/privy-authorization-key-custody";
import { evaluateBasePreSignPolicy } from "@red-cup-engineering/base-pre-sign-policy-service";
import {
  BASE_CHAIN_ID,
  createVirtualsCommercialPilotGuard,
  PILOT_OFFERING_NAME,
  PILOT_PRICE,
} from "./virtuals-commercial-pilot-guard.mjs";

export const VIRTUALS_PRIVY_APP_ID = "cltsev9j90f67yhyw4sngtrpv";
export const ALCHEMY_SIGNING_CONTRACT = "0x69007702764179f14F51cdce752f4f775d74e139";
export const PILOT_OFFERING = Object.freeze({
  name: PILOT_OFFERING_NAME,
  jobFee: PILOT_PRICE,
  jobFeeType: "fixed",
  requiredFunds: false,
});

function requirementFrom(entry) {
  if (entry?.kind !== "message" || entry.contentType !== "requirement" || typeof entry.content !== "string") return null;
  let value;
  try { value = JSON.parse(entry.content); }
  catch { throw new TypeError("Virtuals requirement message must contain valid JSON"); }
  if (value === null || typeof value !== "object" || Array.isArray(value) || !Object.hasOwn(value, "request")) {
    throw new TypeError("Virtuals requirement must contain one request object");
  }
  return value.request;
}

function findRequirement(session) {
  for (let index = session.entries.length - 1; index >= 0; index -= 1) {
    const request = requirementFrom(session.entries[index]);
    if (request !== null) return request;
  }
  throw new TypeError("funded Virtuals pilot job has no requirement message");
}

function requireProviderSession(session) {
  if (session?.chainId !== BASE_CHAIN_ID) throw new TypeError("Virtuals pilot runtime refuses non-Base sessions");
  if (!Array.isArray(session.roles) || !session.roles.includes("provider")) throw new TypeError("Virtuals pilot runtime accepts only provider-role sessions");
  if (session.job?.description !== PILOT_OFFERING_NAME) throw new TypeError("Virtuals pilot runtime refuses other offerings");
}

export function createVirtualsPilotEntryHandler({ guard, AssetToken, onTerminal = async () => {}, onRefusal = async () => {} }) {
  if (typeof guard?.admitJob !== "function" || typeof AssetToken?.usdc !== "function") throw new TypeError("Virtuals pilot handler requires its guard and AssetToken provider");
  if (typeof onTerminal !== "function" || typeof onRefusal !== "function") throw new TypeError("Virtuals pilot callbacks must be functions");

  return async function handleEntry(session, entry) {
    try {
      requireProviderSession(session);
      if (entry.kind === "message" && entry.contentType === "requirement" && session.status === "open") {
        const request = requirementFrom(entry);
        evaluateBasePreSignPolicy(request);
        await guard.admitJob({ jobId: session.jobId, chainId: session.chainId, offering: PILOT_OFFERING });
        await session.setBudget(AssetToken.usdc(0.01, BASE_CHAIN_ID));
        return Object.freeze({ disposition: "budget-set", jobId: String(session.jobId), amount: PILOT_PRICE, currency: "USDC" });
      }
      if (entry.kind === "system" && entry.event?.type === "job.funded") {
        const request = findRequirement(session);
        const receipt = evaluateBasePreSignPolicy(request);
        await guard.admitJob({ jobId: session.jobId, chainId: session.chainId, offering: PILOT_OFFERING });
        await session.submit(JSON.stringify(receipt));
        return Object.freeze({ disposition: "submitted", jobId: String(session.jobId), receipt: receipt.id });
      }
      if (entry.kind === "system" && ["job.completed", "job.rejected", "job.expired"].includes(entry.event?.type)) {
        if (!(await guard.isClaimedJob(session.jobId))) return Object.freeze({ disposition: "ignored", jobId: String(session.jobId) });
        await onTerminal({ jobId: String(session.jobId), event: entry.event.type });
        return Object.freeze({ disposition: "terminal", jobId: String(session.jobId), event: entry.event.type });
      }
      return Object.freeze({ disposition: "ignored", jobId: String(session.jobId) });
    } catch (error) {
      await onRefusal({ jobId: session?.jobId === undefined ? null : String(session.jobId), error });
      return Object.freeze({ disposition: "refused", jobId: session?.jobId === undefined ? null : String(session.jobId), reason: error instanceof Error ? error.message : String(error) });
    }
  };
}

export async function startVirtualsCommercialPilot({
  walletAddress,
  walletId,
  authorizationKeystorePath,
  authorizationPasswordFile,
  stateRoot,
  forbiddenOperatorWallets = [],
  expiresAt,
  privyAppId = VIRTUALS_PRIVY_APP_ID,
  builderCode,
  onTerminal,
  onRefusal,
}) {
  const [{ AcpAgent, AssetToken, PrivyAlchemyEvmProviderAdapter }, { base }] = await Promise.all([
    import("@virtuals-protocol/acp-node-v2"),
    import("@account-kit/infra"),
  ]);
  const guard = await createVirtualsCommercialPilotGuard({
    operatorWalletAddress: walletAddress,
    stateRoot: resolve(stateRoot),
    forbiddenOperatorWallets,
  });
  const signFn = createPolicyBoundPrivyAuthorizationSignFn({
    path: resolve(authorizationKeystorePath),
    passwordFile: resolve(authorizationPasswordFile),
    keystoreProfile: {
      type: "urn:ame:blockchain-trashpanda:privy-authorization-key-keystore",
      keyIdDomain: "blockchain-trashpanda.privy-p256-public-key",
    },
    policy: {
      walletId,
      privyAppId,
      walletAddress,
      allowedRpcMethods: ["personal_sign", "eth_signUserOperation", "eth_sign7702Authorization"],
      allowedChainIds: [BASE_CHAIN_ID],
      allowedContracts: [ALCHEMY_SIGNING_CONTRACT],
      personalSign: { messagePrefix: "acp-auth:", maxClockSkewMs: 60_000 },
      expiresAt,
      maxSignatures: 16,
    },
  });
  const delegate = await PrivyAlchemyEvmProviderAdapter.create({
    walletAddress,
    walletId,
    signFn,
    chains: [base],
    privyAppId,
    ...(builderCode === undefined ? {} : { builderCode }),
  });
  const agent = await AcpAgent.create({ provider: guard.wrapAdapter(delegate) });
  const handleEntry = createVirtualsPilotEntryHandler({
    guard,
    AssetToken,
    onRefusal,
    onTerminal: async (event) => {
      await onTerminal?.(event);
      await agent.stop();
    },
  });
  agent.on("entry", handleEntry);
  await agent.start();
  return Object.freeze({ agent, guard, signer: signFn.descriptor, stop: () => agent.stop() });
}
