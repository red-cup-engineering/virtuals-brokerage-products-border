import { existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileText } from "@red-cup-engineering/computer-file-engineering-services-section/read-file";
import { createIfAbsent } from "./create-if-absent.mjs";
import { sha256Hex } from "@red-cup-engineering/cryptographic-computer-data-engineering-services-section/integrity";

export const BASE_CHAIN_ID = 8453;
export const BASE_ACP_CONTRACT = "0x238e541bfefd82238730d00a2208e5497f1832e0";
export const ACP_SET_BUDGET_SELECTOR = "0xdd4ae9d4";
export const ACP_SUBMIT_SELECTOR = "0x9e63798d";
export const PILOT_OFFERING_NAME = "pre_sign_transaction_policy_conformance";
export const PILOT_PRICE = "0.01";
export const PILOT_USDC_BASE_UNITS = 10_000n;

const MODULE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_AUTHORIZATION_PATH = join(MODULE_ROOT, "data", "authorizations", "one-job-virtuals-commercial-pilot.json");
const HEX_ADDRESS = /^0x[0-9a-fA-F]{40}$/u;
const HEX_CALLDATA = /^0x(?:[0-9a-fA-F]{2})+$/u;
const DECIMAL_ID = /^(?:0|[1-9][0-9]*)$/u;

function normalizeAddress(value, label) {
  if (typeof value !== "string" || !HEX_ADDRESS.test(value)) throw new TypeError(`${label} must be an EVM address`);
  return value.toLowerCase();
}

function normalizeAddressSet(values, label) {
  if (!Array.isArray(values)) throw new TypeError(`${label} must be an array of EVM addresses`);
  return new Set(values.map((value) => normalizeAddress(value, label)));
}


function ensurePrivateDirectory(path) {
  if (!existsSync(path)) mkdirSync(path, { recursive: true, mode: 0o700 });
  const stat = statSync(path);
  if (!stat.isDirectory()) throw new TypeError("commercial pilot state root must be a directory");
  if ((stat.mode & 0o077) !== 0) throw new TypeError("commercial pilot state root must be private");
}

async function readJson(path, label) {
  let value;
  try { value = JSON.parse(await readFileText(path)); }
  catch { throw new TypeError(`${label} must be valid JSON`); }
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  return value;
}


async function requireAuthorization(path) {
  const authorization = await readJson(path, "commercial pilot authorization");
  if (authorization.enterprise !== "urn:ame:blockchain-trashpanda"
      || authorization.platform !== "Virtuals ACP"
      || authorization.network !== "eip155:8453"
      || authorization.jobLimit !== 1
      || authorization.jobType !== "service-only"
      || authorization.exactPrice?.amount !== PILOT_PRICE
      || authorization.exactPrice?.currency !== "USDC"
      || authorization.operatorWallet?.separation !== "new-and-separate"
      || !authorization.forbiddenEffects?.includes("fund-transfer-job")
      || !authorization.forbiddenEffects?.includes("broader-launch")) {
    throw new TypeError("commercial pilot authorization does not admit the exact one-job pilot");
  }
  return authorization;
}

function normalizeJobId(value) {
  const text = typeof value === "bigint" ? value.toString(10) : String(value);
  if (!DECIMAL_ID.test(text)) throw new TypeError("Virtuals jobId must be a nonnegative decimal integer");
  return text;
}

function requireOffering(offering) {
  const exactFee = offering?.jobFee === PILOT_PRICE || offering?.jobFee === 0.01;
  if (offering?.name !== PILOT_OFFERING_NAME
      || !exactFee
      || offering.jobFeeType !== "fixed"
      || offering.requiredFunds !== false) {
    throw new TypeError("Virtuals job does not match the authorized 0.01 USDC service-only offering");
  }
}

function sameClaim(actual, expected) {
  return actual.type === expected.type
    && actual.authorization === expected.authorization
    && actual.jobId === expected.jobId
    && actual.chainId === expected.chainId
    && actual.operatorWallet === expected.operatorWallet
    && actual.offering?.name === expected.offering.name
    && actual.offering?.jobFee === expected.offering.jobFee
    && actual.offering?.jobFeeType === expected.offering.jobFeeType
    && actual.offering?.requiredFunds === expected.offering.requiredFunds;
}

function normalizeCall(call, expectedJobId) {
  if (call === null || typeof call !== "object" || Array.isArray(call)) throw new TypeError("Virtuals ACP call must be an object");
  const target = normalizeAddress(call.to, "Virtuals ACP call target");
  if (target !== BASE_ACP_CONTRACT) throw new TypeError("commercial pilot refuses calls outside the official Base ACP contract");
  const value = call.value ?? 0n;
  if (value !== 0n && value !== 0 && value !== "0x0") throw new TypeError("commercial pilot refuses nonzero call value");
  if (typeof call.data !== "string" || !HEX_CALLDATA.test(call.data) || call.data.length < 74) {
    throw new TypeError("Virtuals ACP call data is malformed");
  }
  const data = call.data.toLowerCase();
  const selector = data.slice(0, 10);
  if (selector !== ACP_SET_BUDGET_SELECTOR && selector !== ACP_SUBMIT_SELECTOR) {
    throw new TypeError("commercial pilot permits only exact ACP setBudget and submit phases");
  }
  const callJobId = BigInt(`0x${data.slice(10, 74)}`).toString(10);
  if (callJobId !== expectedJobId) throw new TypeError("ACP submit call does not target the claimed pilot job");
  if (selector === ACP_SET_BUDGET_SELECTOR) {
    if (data.length < 138) throw new TypeError("ACP setBudget call data is malformed");
    const amount = BigInt(`0x${data.slice(74, 138)}`);
    if (amount !== PILOT_USDC_BASE_UNITS) throw new TypeError("ACP setBudget must be exactly 0.01 USDC");
  }
  return Object.freeze({ phase: selector === ACP_SET_BUDGET_SELECTOR ? "set-budget" : "submit", to: target, data, value: "0" });
}

function requireDelegate(delegate) {
  const methods = ["getAddress", "getSupportedChainIds", "getNetworkContext", "sendCalls", "getTransactionReceipt", "readContract", "getLogs", "getBlockNumber"];
  for (const method of methods) if (typeof delegate?.[method] !== "function") throw new TypeError(`Virtuals delegate is missing ${method}`);
}

export async function createVirtualsCommercialPilotGuard({
  operatorWalletAddress,
  stateRoot,
  authorizationPath = DEFAULT_AUTHORIZATION_PATH,
  forbiddenOperatorWallets = [],
  now = () => new Date().toISOString(),
}) {
  await requireAuthorization(authorizationPath);
  const operatorWallet = normalizeAddress(operatorWalletAddress, "operator wallet");
  if (normalizeAddressSet(forbiddenOperatorWallets, "forbidden operator wallet").has(operatorWallet)) {
    throw new TypeError("commercial pilot operator wallet is forbidden");
  }
  if (typeof now !== "function") throw new TypeError("now must be a function");
  const root = resolve(stateRoot);
  ensurePrivateDirectory(root);
  const claimPath = join(root, "job-claim.json");
  const budgetPath = join(root, "set-budget-attempt.json");
  const submissionPath = join(root, "submission-attempt.json");
  const publicationPath = join(root, "offering-publication-attempt.json");
  const acceptancePath = join(root, "job-acceptance-attempt.json");
  const paymentRequestPath = join(root, "payment-request-attempt.json");
  const deliverablePath = join(root, "deliverable-attempt.json");
  const delistingPath = join(root, "offering-delisting-attempt.json");

  async function admitJob({ jobId, chainId, offering }) {
    if (chainId !== BASE_CHAIN_ID) throw new TypeError("commercial pilot permits only Base chain 8453");
    requireOffering(offering);
    const normalizedJobId = normalizeJobId(jobId);
    const claim = {
      type: "BlockchainTrashpandaVirtualsPilotJobClaim",
      jobId: normalizedJobId,
      chainId: BASE_CHAIN_ID,
      operatorWallet,
      offering: { name: PILOT_OFFERING_NAME, jobFee: PILOT_PRICE, jobFeeType: "fixed", requiredFunds: false },
      admittedAt: now(),
    };
    if (await createIfAbsent(claimPath, JSON.stringify(claim) + "\n", 0o600)) return Object.freeze(claim);
    const existing = await readJson(claimPath, "commercial pilot job claim");
    if (!sameClaim(existing, claim)) throw new TypeError("commercial pilot has already claimed a different job");
    return Object.freeze(existing);
  }

  async function readClaim() {
    if (!existsSync(claimPath)) throw new TypeError("commercial pilot has no admitted job");
    return readJson(claimPath, "commercial pilot job claim");
  }

  async function isClaimedJob(jobId) {
    if (!existsSync(claimPath)) return false;
    return (await readClaim()).jobId === normalizeJobId(jobId);
  }

  async function admitOfferingEffect(effect, offering) {
    requireOffering(offering);
    const paths = {
      publish: publicationPath,
      delist: delistingPath,
    };
    const path = paths[effect];
    if (!path) throw new TypeError(`commercial pilot refuses offering effect ${effect}`);
    const attempt = {
      type: effect === "publish"
        ? "BlockchainTrashpandaVirtualsPilotOfferingPublicationAttempt"
        : "BlockchainTrashpandaVirtualsPilotOfferingDelistingAttempt",
      operatorWallet,
      offering: { name: PILOT_OFFERING_NAME, jobFee: PILOT_PRICE, jobFeeType: "fixed", requiredFunds: false },
      attemptedAt: now(),
      retry: false,
    };
    if (!(await createIfAbsent(path, JSON.stringify(attempt) + "\n", 0o600))) {
      throw new TypeError(`commercial pilot offering ${effect} attempt is already exhausted; retry is refused`);
    }
    return Object.freeze(attempt);
  }

  async function admitLiteJobEffect({ jobId, effect, payload }) {
    const claim = await readClaim();
    const normalizedJobId = normalizeJobId(jobId);
    if (claim.jobId !== normalizedJobId) throw new TypeError("commercial pilot refuses an effect for an unclaimed job");
    const paths = {
      accept: acceptancePath,
      "request-payment": paymentRequestPath,
      deliver: deliverablePath,
    };
    const path = paths[effect];
    if (!path) throw new TypeError(`commercial pilot refuses Lite job effect ${effect}`);
    if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
      throw new TypeError("commercial pilot Lite job effect requires an object payload");
    }
    if (effect === "accept" && (payload.accept !== true || Object.keys(payload).some((key) => !["accept", "reason"].includes(key)))) {
      throw new TypeError("commercial pilot permits only an exact positive acceptance payload");
    }
    if (effect === "request-payment"
        && (typeof payload.content !== "string" || payload.content.length < 1 || Object.hasOwn(payload, "payableDetail")
          || Object.keys(payload).some((key) => key !== "content"))) {
      throw new TypeError("commercial pilot payment request must contain content and no fund-transfer detail");
    }
    if (effect === "deliver"
        && (!Object.hasOwn(payload, "deliverable") || Object.hasOwn(payload, "payableDetail")
          || Object.keys(payload).some((key) => key !== "deliverable"))) {
      throw new TypeError("commercial pilot delivery must contain only the service receipt");
    }
    const attempt = {
      type: `BlockchainTrashpandaVirtualsPilot${effect.split("-").map((part) => part[0].toUpperCase() + part.slice(1)).join("")}Attempt`,
      jobId: normalizedJobId,
      operatorWallet,
      effect,
      payloadSha256: sha256Hex(JSON.stringify(payload)),
      attemptedAt: now(),
      retry: false,
    };
    if (!(await createIfAbsent(path, JSON.stringify(attempt) + "\n", 0o600))) {
      throw new TypeError(`commercial pilot ${effect} attempt is already exhausted; retry is refused`);
    }
    return Object.freeze(attempt);
  }

  function wrapAdapter(delegate) {
    requireDelegate(delegate);
    const adapter = {
      providerName: "Yanagi one-job Virtuals commercial pilot",
      async getAddress() {
        const delegated = normalizeAddress(await delegate.getAddress(), "delegate wallet");
        if (delegated !== operatorWallet) throw new TypeError("Virtuals delegate wallet does not match the separate operator wallet");
        return delegated;
      },
      async getSupportedChainIds() { return [BASE_CHAIN_ID]; },
      async getNetworkContext(chainId) {
        if (chainId !== BASE_CHAIN_ID) throw new TypeError("commercial pilot permits only Base chain 8453");
        return delegate.getNetworkContext(chainId);
      },
      async sendTransaction() { throw new TypeError("commercial pilot refuses sendTransaction and fund-transfer paths"); },
      async sendCalls(chainId, calls) {
        if (chainId !== BASE_CHAIN_ID) throw new TypeError("commercial pilot permits only Base chain 8453");
        if (!Array.isArray(calls) || calls.length !== 1) throw new TypeError("commercial pilot permits exactly one ACP submit call");
        const claim = await readClaim();
        const normalizedCall = normalizeCall(calls[0], claim.jobId);
        const attemptPath = normalizedCall.phase === "set-budget" ? budgetPath : submissionPath;
        const attempt = {
          type: normalizedCall.phase === "set-budget"
            ? "BlockchainTrashpandaVirtualsPilotSetBudgetAttempt"
            : "BlockchainTrashpandaVirtualsPilotSubmissionAttempt",
          jobId: claim.jobId,
          chainId: BASE_CHAIN_ID,
          operatorWallet,
          callSha256: sha256Hex(JSON.stringify(normalizedCall)),
          attemptedAt: now(),
          retry: false,
        };
        if (!(await createIfAbsent(attemptPath, JSON.stringify(attempt) + "\n", 0o600))) {
          throw new TypeError(`commercial pilot ${normalizedCall.phase} attempt is already exhausted; retry is refused`);
        }
        return delegate.sendCalls(chainId, calls);
      },
      async getTransactionReceipt(chainId, hash) {
        if (chainId !== BASE_CHAIN_ID) throw new TypeError("commercial pilot permits only Base chain 8453");
        return delegate.getTransactionReceipt(chainId, hash);
      },
      async readContract(chainId, params) {
        if (chainId !== BASE_CHAIN_ID) throw new TypeError("commercial pilot permits only Base chain 8453");
        return delegate.readContract(chainId, params);
      },
      async getLogs(chainId, params) {
        if (chainId !== BASE_CHAIN_ID) throw new TypeError("commercial pilot permits only Base chain 8453");
        return delegate.getLogs(chainId, params);
      },
      async getBlockNumber(chainId) {
        if (chainId !== BASE_CHAIN_ID) throw new TypeError("commercial pilot permits only Base chain 8453");
        return delegate.getBlockNumber(chainId);
      },
      async signMessage() { throw new TypeError("commercial pilot adapter refuses arbitrary message signing"); },
      async signTypedData() { throw new TypeError("commercial pilot adapter refuses arbitrary typed-data signing"); },
    };
    return Object.freeze(adapter);
  }

  return Object.freeze({
    operatorWallet,
    claimPath,
    budgetPath,
    submissionPath,
    publicationPath,
    acceptancePath,
    paymentRequestPath,
    deliverablePath,
    delistingPath,
    admitJob,
    isClaimedJob,
    admitOfferingEffect,
    admitLiteJobEffect,
    wrapAdapter,
  });
}
