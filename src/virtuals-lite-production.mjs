import { existsSync, mkdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { io as defaultIo } from "socket.io-client";
import { readFileText } from "@red-cup-engineering/computer-file-engineering-services-section/read-file";
import { evaluateBasePreSignPolicy } from "@red-cup-engineering/base-pre-sign-policy-service";
import { BASE_CHAIN_ID, PILOT_OFFERING_NAME } from "./virtuals-commercial-pilot-guard.mjs";
import { createIfAbsent } from "./create-if-absent.mjs";
import {
  createVirtualsLiteApiClient,
  VIRTUALS_LITE_SOCKET_ORIGIN,
  YANAGI_OPERATOR_WALLET,
} from "./virtuals-lite-commercial-pilot.mjs";
import { sha256Hex } from "@red-cup-engineering/cryptographic-computer-data-engineering-services-section/integrity";

export const VIRTUALS_PRODUCTION_PRICE = "0.05";
export const VIRTUALS_PRODUCTION_USDC_BASE_UNITS = 50_000n;
export const VIRTUALS_PRODUCTION_OFFERING = Object.freeze({
  name: PILOT_OFFERING_NAME,
  description: "Yanagi's Blockchain Trashpanda deterministically evaluates one unsigned Base transaction against the buyer's declared policy and immutable block anchor. Returns a replayable clause-by-clause PASS, FAIL, or ESCALATE receipt. Never accepts keys, signatures, custody, signing, or broadcast authority.",
  priceV2: Object.freeze({ type: "fixed", value: 0.05 }),
  slaMinutes: 5,
  requiredFunds: false,
  requirement: Object.freeze({
    type: "object",
    additionalProperties: false,
    properties: Object.freeze({
      request: Object.freeze({
        type: "object",
        description: "One exact BasePreSignConformanceRequest v1; stricter canonical shape, authority-refusal, and resource limits apply.",
      }),
    }),
    required: Object.freeze(["request"]),
  }),
  deliverable: "BasePreSignPolicyConformanceReceipt v1 JSON",
});

const MODULE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// The real production requirements: a signer keystore (acp-cli's own
// {secret, salt, keys} shape, one entry per admitted key) and the house's
// current-market pricing evidence for this offer. The earlier gate refused
// on a "pilot terminal evidence" and "post-pilot mandate" pair of
// self-authorization documents that named files this package never wrote
// (unconditionally unsatisfiable); production readiness is the operator's
// actual signing capability plus a priced offer, not a process record.
const DEFAULT_SIGNER_KEYS_PATH = join(homedir(), ".config", "acp-cli", "signer-keys.json");
const DEFAULT_PRICING_PATH = join(
  dirname(createRequire(import.meta.url).resolve("@red-cup-engineering/blockchain-trashpanda-services-section/package.json")),
  "data", "evidence", "2026-07-22-virtuals-market-pricing.json",
);
const DECIMAL_ID = /^(?:0|[1-9][0-9]*)$/u;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/u;
const TERMINAL_PHASES = new Set([4, 5, 6]);

function normalizeAddress(value, label) {
  if (typeof value !== "string" || !ADDRESS.test(value)) throw new TypeError(`${label} must be an EVM address`);
  return value.toLowerCase();
}

function normalizeAddressSet(values, label) {
  if (!Array.isArray(values)) throw new TypeError(`${label} must be an array of EVM addresses`);
  return new Set(values.map((value) => normalizeAddress(value, label)));
}

function normalizeJobId(value) {
  const text = String(value);
  if (!DECIMAL_ID.test(text)) throw new TypeError("Virtuals production job ID must be a nonnegative decimal integer");
  return text;
}

async function readObject(path, label) {
  let value;
  try { value = JSON.parse(await readFileText(path)); }
  catch { throw new TypeError(`${label} must be present and valid JSON`); }
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  return value;
}


function privateDirectory(path) {
  if (!existsSync(path)) mkdirSync(path, { recursive: true, mode: 0o700 });
  const stat = statSync(path);
  if (!stat.isDirectory() || (stat.mode & 0o077) !== 0) throw new TypeError("Virtuals production state directories must be private");
  return path;
}


/**
 * Admit a signer keystore in acp-cli's own on-disk shape: one secret/salt
 * pair guarding one or more named keys, each an encrypted
 * `{nonce, ciphertext}` entry. Returns the admitted key count.
 */
function requireSignerKeys(value) {
  if (typeof value.secret !== "string" || value.secret === ""
      || typeof value.salt !== "string" || value.salt === ""
      || value.keys === null || typeof value.keys !== "object" || Array.isArray(value.keys)) {
    throw new TypeError("Virtuals production refuses a signer keystore that is not the acp-cli {secret, salt, keys} shape");
  }
  const entries = Object.values(value.keys);
  if (entries.length === 0 || entries.some((entry) => typeof entry?.nonce !== "string" || typeof entry?.ciphertext !== "string")) {
    throw new TypeError("Virtuals production refuses a signer keystore with no admitted {nonce, ciphertext} key entry");
  }
  return entries.length;
}

export async function requireVirtualsProductionGate({
  signerKeysPath = DEFAULT_SIGNER_KEYS_PATH,
  pricingPath = DEFAULT_PRICING_PATH,
} = {}) {
  const signerKeys = await readObject(signerKeysPath, "Virtuals ACP signer keystore");
  const signerKeyCount = requireSignerKeys(signerKeys);
  const pricing = await readObject(pricingPath, "Virtuals current-market pricing evidence");
  if (pricing.type !== "BlockchainTrashpandaVirtualsCurrentMarketPricingEvidence"
      || pricing.admittedGrossPriceUsdc !== VIRTUALS_PRODUCTION_PRICE
      || pricing.pilotDemandExcluded !== true) {
    throw new TypeError("Virtuals production price lacks current-market admission");
  }
  return Object.freeze({ signerKeyCount, pricing });
}

function negotiation(data) {
  if (!Array.isArray(data?.memos)) throw new TypeError("Virtuals production job memos must be an array");
  const memo = data.memos.find((candidate) => candidate?.nextPhase === 1);
  if (!memo || typeof memo.content !== "string") throw new TypeError("Virtuals production job has no negotiation memo");
  let value;
  try { value = JSON.parse(memo.content); }
  catch { throw new TypeError("Virtuals production negotiation memo must be valid JSON"); }
  if (value?.name !== PILOT_OFFERING_NAME || (value.priceType !== undefined && value.priceType !== "fixed")
      || value.requirement === null || typeof value.requirement !== "object" || Array.isArray(value.requirement)) {
    throw new TypeError("Virtuals production negotiation does not match the admitted offering");
  }
  return value.requirement.request;
}

function envelope(data, operatorWallet) {
  const id = normalizeJobId(data?.id);
  if (data.price !== 0.05 && data.price !== VIRTUALS_PRODUCTION_PRICE) throw new TypeError("Virtuals production price must be exactly 0.05 USDC");
  if (normalizeAddress(data.providerAddress, "Virtuals production provider") !== operatorWallet) {
    throw new TypeError("Virtuals production provider is not Yanagi's separate operator wallet");
  }
  if (data.requiredFunds === true || data.payableDetail !== undefined) throw new TypeError("Virtuals production refuses buyer-fund transfer or custody");
  return id;
}

export function createVirtualsProductionGuard({
  stateRoot,
  operatorWalletAddress = YANAGI_OPERATOR_WALLET,
  forbiddenOperatorWallets = [],
  now = () => new Date().toISOString(),
}) {
  const operatorWallet = normalizeAddress(operatorWalletAddress, "Virtuals production operator");
  if (normalizeAddressSet(forbiddenOperatorWallets, "forbidden production operator wallet").has(operatorWallet)) {
    throw new TypeError("Virtuals production operator wallet is forbidden");
  }
  const root = privateDirectory(resolve(stateRoot));
  const jobsRoot = privateDirectory(join(root, "jobs"));
  const publicationPath = join(root, "offering-publication-attempt.json");

  function jobDirectory(jobId) {
    return privateDirectory(join(jobsRoot, normalizeJobId(jobId)));
  }

  async function claim(jobId, request) {
    const id = normalizeJobId(jobId);
    const requestSha256 = sha256Hex(JSON.stringify(request));
    const path = join(jobDirectory(id), "claim.json");
    const value = { type: "BlockchainTrashpandaVirtualsProductionJobClaim", jobId: id, operatorWallet, priceUsdc: VIRTUALS_PRODUCTION_PRICE, serviceOnly: true, requestSha256, admittedAt: now() };
    if (!(await createIfAbsent(path, JSON.stringify(value) + "\n", 0o600))) {
      const existing = await readObject(path, "Virtuals production job claim");
      if (existing.jobId !== id || existing.operatorWallet !== operatorWallet || existing.requestSha256 !== requestSha256) {
        throw new TypeError("Virtuals production job identifier is already bound to different work");
      }
      return Object.freeze(existing);
    }
    return Object.freeze(value);
  }

  function requireClaim(jobId) {
    return readObject(join(jobDirectory(jobId), "claim.json"), "Virtuals production job claim");
  }

  async function effect(jobId, name, payload) {
    const claimValue = await requireClaim(jobId);
    const allowed = new Set(["accept", "request-payment", "deliver", "terminal"]);
    if (!allowed.has(name)) throw new TypeError(`Virtuals production refuses effect ${name}`);
    if (name === "request-payment" && (Object.hasOwn(payload, "payableDetail") || Object.keys(payload).some((key) => key !== "content"))) {
      throw new TypeError("Virtuals production payment request must not contain fund-transfer detail");
    }
    if (name === "deliver" && (Object.hasOwn(payload, "payableDetail") || Object.keys(payload).some((key) => key !== "deliverable"))) {
      throw new TypeError("Virtuals production delivery must contain only the service receipt");
    }
    const value = {
      type: "BlockchainTrashpandaVirtualsProductionEffectAttempt",
      jobId: claimValue.jobId,
      effect: name,
      payloadSha256: sha256Hex(JSON.stringify(payload)),
      attemptedAt: now(),
      retry: false,
    };
    if (!(await createIfAbsent(join(jobDirectory(jobId), `${name}.json`), JSON.stringify(value) + "\n", 0o600))) throw new TypeError(`Virtuals production ${name} attempt is already exhausted`);
    return Object.freeze(value);
  }

  async function admitPublication() {
    const value = {
      type: "BlockchainTrashpandaVirtualsProductionOfferingPublicationAttempt",
      operatorWallet,
      offering: PILOT_OFFERING_NAME,
      priceUsdc: VIRTUALS_PRODUCTION_PRICE,
      requiredFunds: false,
      attemptedAt: now(),
      retry: false,
    };
    if (!(await createIfAbsent(publicationPath, JSON.stringify(value) + "\n", 0o600))) throw new TypeError("Virtuals production offering publication attempt is already exhausted");
    return Object.freeze(value);
  }

  return Object.freeze({ operatorWallet, root, publicationPath, admitPublication, claim, requireClaim, effect });
}

function profile(value) { return value?.data?.data ?? value?.data ?? value; }

export async function ensureVirtualsProductionOffering({ client, guard, gateOptions }) {
  const gate = await requireVirtualsProductionGate(gateOptions);
  const current = profile(await client.me());
  if (current?.name !== "Yanagi" || normalizeAddress(current.walletAddress, "Virtuals profile wallet") !== guard.operatorWallet) {
    throw new TypeError("Virtuals credential is not bound to Yanagi's admitted operator identity");
  }
  const existing = (Array.isArray(current.jobs) ? current.jobs : []).find((candidate) => candidate?.name === PILOT_OFFERING_NAME);
  if (existing) {
    if (existing.priceV2?.type !== "fixed" || existing.priceV2?.value !== 0.05 || existing.requiredFunds !== false) {
      throw new TypeError("the pilot or another incompatible offering still occupies the production offering name");
    }
    return Object.freeze({ disposition: "already-published", gate });
  }
  await guard.admitPublication();
  await client.publishOffering(VIRTUALS_PRODUCTION_OFFERING);
  return Object.freeze({ disposition: "published", gate });
}

export function createVirtualsProductionJobHandler({ client, guard, onEvent = async () => {} }) {
  return async function handle(data) {
    let id = null;
    try {
      id = envelope(data, guard.operatorWallet);
      const request = negotiation(data);
      if (data.phase === 0) {
        if (data.memoToSign === undefined) return Object.freeze({ disposition: "ignored", jobId: id });
        evaluateBasePreSignPolicy(request);
        await guard.claim(id, request);
        const acceptance = { accept: true, reason: "Exact service-only pre-sign policy-conformance job admitted" };
        await guard.effect(id, "accept", acceptance);
        await client.accept(id, acceptance);
        const payment = { content: "0.05 USDC fixed service fee; no additional funds, custody, token gate, signing, or broadcast authority." };
        await guard.effect(id, "request-payment", payment);
        await client.requestPayment(id, payment);
        await onEvent({ type: "production-job-admitted", jobId: id });
        return Object.freeze({ disposition: "payment-requested", jobId: id });
      }
      if (data.phase === 2) {
        await guard.requireClaim(id);
        const receipt = evaluateBasePreSignPolicy(request);
        const delivery = { deliverable: JSON.stringify(receipt) };
        await guard.effect(id, "deliver", delivery);
        await client.deliver(id, delivery);
        await onEvent({ type: "production-job-delivered", jobId: id, receiptId: receipt.id });
        return Object.freeze({ disposition: "delivered", jobId: id, receiptId: receipt.id });
      }
      if (TERMINAL_PHASES.has(data.phase)) {
        await guard.requireClaim(id);
        await guard.effect(id, "terminal", { phase: data.phase });
        await onEvent({ type: "production-job-terminal", jobId: id, phase: data.phase });
        return Object.freeze({ disposition: "terminal", jobId: id, phase: data.phase });
      }
      return Object.freeze({ disposition: "ignored", jobId: id });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      await onEvent({ type: "production-job-refusal", jobId: id, reason });
      return Object.freeze({ disposition: "refused", jobId: id, reason });
    }
  };
}

export async function startVirtualsLiteProduction({
  apiKey,
  stateRoot,
  gateOptions,
  operatorWalletAddress = YANAGI_OPERATOR_WALLET,
  forbiddenOperatorWallets = [],
  fetchImpl = fetch,
  ioFactory = defaultIo,
  socketOrigin = VIRTUALS_LITE_SOCKET_ORIGIN,
  onEvent = async () => {},
}) {
  if (socketOrigin !== VIRTUALS_LITE_SOCKET_ORIGIN) throw new TypeError("Virtuals production refuses a non-official socket origin");
  const guard = createVirtualsProductionGuard({ stateRoot, operatorWalletAddress, forbiddenOperatorWallets });
  const client = createVirtualsLiteApiClient({ apiKey, fetchImpl });
  const publication = await ensureVirtualsProductionOffering({ client, guard, gateOptions });
  const handle = createVirtualsProductionJobHandler({ client, guard, onEvent });
  const socket = ioFactory(socketOrigin, { auth: { walletAddress: guard.operatorWallet }, transports: ["websocket"] });
  socket.on("roomJoined", (_data, acknowledge) => { if (typeof acknowledge === "function") acknowledge(true); });
  for (const event of ["onNewTask", "onEvaluate"]) socket.on(event, (data, acknowledge) => {
    if (typeof acknowledge === "function") acknowledge(true);
    void handle(data);
  });
  socket.on("connect_error", (error) => { void onEvent({ type: "socket-error", reason: error.message }); });
  return Object.freeze({ guard, client, publication, handle, stop: () => socket.disconnect() });
}
