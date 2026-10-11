import { io as defaultIo } from "socket.io-client";
import { evaluateBasePreSignPolicy } from "@red-cup-engineering/base-pre-sign-policy-service";
import {
  BASE_CHAIN_ID,
  createVirtualsCommercialPilotGuard,
  PILOT_OFFERING_NAME,
  PILOT_PRICE,
} from "./virtuals-commercial-pilot-guard.mjs";

export const VIRTUALS_LITE_API_ORIGIN = "https://claw-api.virtuals.io";
export const VIRTUALS_LITE_SOCKET_ORIGIN = "https://acpx.virtuals.io";
export const YANAGI_LITE_AGENT_ID = "44184";
export const YANAGI_OPERATOR_WALLET = "0x9e1e497e38b776db1a79f0db9dd558bcca8b26fc";

export const VIRTUALS_LITE_PILOT_OFFERING = Object.freeze({
  name: PILOT_OFFERING_NAME,
  description: "Deterministically evaluate one unsigned Base transaction against the buyer's declared policy and immutable block anchor. Returns a replayable clause-by-clause PASS, FAIL, or ESCALATE receipt. Never accepts keys, signatures, custody, or broadcast authority.",
  priceV2: Object.freeze({ type: "fixed", value: 0.01 }),
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

const PHASE = Object.freeze({ REQUEST: 0, TRANSACTION: 2, COMPLETED: 4, REJECTED: 5, EXPIRED: 6 });
const TERMINAL_PHASES = new Set([PHASE.COMPLETED, PHASE.REJECTED, PHASE.EXPIRED]);
const DECIMAL_ID = /^(?:0|[1-9][0-9]*)$/u;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/u;

function normalizeAddress(value, label) {
  if (typeof value !== "string" || !ADDRESS.test(value)) throw new TypeError(`${label} must be an EVM address`);
  return value.toLowerCase();
}

function jobId(value) {
  const text = String(value);
  if (!DECIMAL_ID.test(text)) throw new TypeError("Virtuals Lite job ID must be a nonnegative decimal integer");
  return text;
}

function exactPrice(value) {
  return value === 0.01 || value === "0.01";
}

function parseNegotiation(data) {
  if (!Array.isArray(data?.memos)) throw new TypeError("Virtuals Lite job memos must be an array");
  const memo = data.memos.find((candidate) => candidate?.nextPhase === 1);
  if (!memo || typeof memo.content !== "string") throw new TypeError("Virtuals Lite job has no negotiation memo");
  let negotiation;
  try { negotiation = JSON.parse(memo.content); }
  catch { throw new TypeError("Virtuals Lite negotiation memo must be valid JSON"); }
  if (negotiation === null || typeof negotiation !== "object" || Array.isArray(negotiation)) {
    throw new TypeError("Virtuals Lite negotiation memo must be an object");
  }
  if (negotiation.name !== PILOT_OFFERING_NAME) throw new TypeError("Virtuals Lite pilot refuses another offering");
  if (negotiation.priceType !== undefined && negotiation.priceType !== "fixed") {
    throw new TypeError("Virtuals Lite pilot refuses non-fixed pricing");
  }
  if (negotiation.requirement === null || typeof negotiation.requirement !== "object" || Array.isArray(negotiation.requirement)) {
    throw new TypeError("Virtuals Lite pilot requirement must be an object");
  }
  return Object.freeze({ memo, request: negotiation.requirement.request });
}

function requireJobEnvelope(data, operatorWallet) {
  const id = jobId(data?.id);
  if (!exactPrice(data.price)) throw new TypeError("Virtuals Lite pilot job price must be exactly 0.01 USDC");
  if (normalizeAddress(data.providerAddress, "Virtuals Lite provider") !== operatorWallet) {
    throw new TypeError("Virtuals Lite pilot provider is not Yanagi's separate operator wallet");
  }
  return id;
}

async function responseJson(response, label) {
  const text = await response.text();
  let value = null;
  if (text.length > 0) {
    try { value = JSON.parse(text); }
    catch { throw new Error(`${label} returned non-JSON data (${response.status})`); }
  }
  if (!response.ok) {
    const detail = value?.message ?? value?.error ?? `HTTP ${response.status}`;
    throw new Error(`${label} failed: ${typeof detail === "string" ? detail : JSON.stringify(detail)}`);
  }
  return value;
}

export function createVirtualsLiteApiClient({ apiKey, fetchImpl = fetch, apiOrigin = VIRTUALS_LITE_API_ORIGIN }) {
  if (typeof apiKey !== "string" || apiKey.length < 16) throw new TypeError("Virtuals Lite API key is missing or malformed");
  if (typeof fetchImpl !== "function") throw new TypeError("Virtuals Lite client requires fetch");
  if (apiOrigin !== VIRTUALS_LITE_API_ORIGIN) throw new TypeError("Virtuals Lite client refuses a non-official API origin");

  async function call(path, method = "GET", body) {
    if (!path.startsWith("/acp/")) throw new TypeError("Virtuals Lite client refuses a non-ACP path");
    const response = await fetchImpl(`${apiOrigin}${path}`, {
      method,
      headers: {
        "x-api-key": apiKey,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      redirect: "error",
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return responseJson(response, `${method} ${path}`);
  }

  return Object.freeze({
    me: () => call("/acp/me"),
    publishOffering: (offering) => call("/acp/job-offerings", "POST", { data: offering }),
    delistOffering: (name) => call(`/acp/job-offerings/${encodeURIComponent(name)}`, "DELETE"),
    accept: (id, payload) => call(`/acp/providers/jobs/${jobId(id)}/accept`, "POST", payload),
    requestPayment: (id, payload) => call(`/acp/providers/jobs/${jobId(id)}/requirement`, "POST", payload),
    deliver: (id, payload) => call(`/acp/providers/jobs/${jobId(id)}/deliverable`, "POST", payload),
    job: (id) => call(`/acp/jobs/${jobId(id)}`),
  });
}

function agentRecord(value) {
  return value?.data?.data ?? value?.data ?? value;
}

function sameOffering(value) {
  return value?.name === VIRTUALS_LITE_PILOT_OFFERING.name
    && value?.priceV2?.type === "fixed"
    && exactPrice(value?.priceV2?.value)
    && value?.requiredFunds === false;
}

export async function ensureVirtualsLitePilotOffering({ client, guard }) {
  const profile = agentRecord(await client.me());
  if (profile?.name !== "Yanagi") throw new TypeError("Virtuals Lite credential is not bound to the Yanagi agent");
  if (normalizeAddress(profile.walletAddress, "Virtuals Lite profile wallet") !== guard.operatorWallet) {
    throw new TypeError("Virtuals Lite credential is not bound to Yanagi's admitted operator wallet");
  }
  const jobs = Array.isArray(profile.jobs) ? profile.jobs : [];
  const existing = jobs.find((candidate) => candidate?.name === PILOT_OFFERING_NAME);
  if (existing) {
    if (!sameOffering(existing)) throw new TypeError("an incompatible Yanagi offering already uses the pilot name");
    return Object.freeze({ disposition: "already-published", profile });
  }
  await guard.admitOfferingEffect("publish", {
    name: PILOT_OFFERING_NAME,
    jobFee: PILOT_PRICE,
    jobFeeType: "fixed",
    requiredFunds: false,
  });
  await client.publishOffering(VIRTUALS_LITE_PILOT_OFFERING);
  return Object.freeze({ disposition: "published", profile });
}

export function createVirtualsLitePilotJobHandler({ client, guard, stop = async () => {}, onEvent = async () => {} }) {
  if (!client || typeof client.accept !== "function" || typeof guard?.admitJob !== "function") {
    throw new TypeError("Virtuals Lite pilot handler requires its API client and guard");
  }
  if (typeof stop !== "function" || typeof onEvent !== "function") throw new TypeError("Virtuals Lite pilot callbacks must be functions");

  return async function handle(data) {
    let id = null;
    try {
      id = requireJobEnvelope(data, guard.operatorWallet);
      const { request } = parseNegotiation(data);
      if (data.phase === PHASE.REQUEST) {
        if (data.memoToSign === undefined) return Object.freeze({ disposition: "ignored", jobId: id });
        evaluateBasePreSignPolicy(request);
        await guard.admitJob({
          jobId: id,
          chainId: BASE_CHAIN_ID,
          offering: { name: PILOT_OFFERING_NAME, jobFee: PILOT_PRICE, jobFeeType: "fixed", requiredFunds: false },
        });
        const acceptance = { accept: true, reason: "Exact one-job Yanagi policy-conformance pilot admitted" };
        await guard.admitLiteJobEffect({ jobId: id, effect: "accept", payload: acceptance });
        await client.accept(id, acceptance);
        const payment = { content: "0.01 USDC fixed service fee; no additional funds, custody, token gate, signing, or broadcast authority." };
        await guard.admitLiteJobEffect({ jobId: id, effect: "request-payment", payload: payment });
        await client.requestPayment(id, payment);
        await onEvent({ type: "pilot-job-admitted", jobId: id });
        return Object.freeze({ disposition: "payment-requested", jobId: id });
      }
      if (data.phase === PHASE.TRANSACTION) {
        if (!(await guard.isClaimedJob(id))) throw new TypeError("Virtuals Lite pilot refuses delivery for an unclaimed job");
        const receipt = evaluateBasePreSignPolicy(request);
        const delivery = { deliverable: JSON.stringify(receipt) };
        await guard.admitLiteJobEffect({ jobId: id, effect: "deliver", payload: delivery });
        await client.deliver(id, delivery);
        await guard.admitOfferingEffect("delist", {
          name: PILOT_OFFERING_NAME,
          jobFee: PILOT_PRICE,
          jobFeeType: "fixed",
          requiredFunds: false,
        });
        await client.delistOffering(PILOT_OFFERING_NAME);
        await onEvent({ type: "pilot-delivered-and-delisted", jobId: id, receiptId: receipt.id });
        await stop();
        return Object.freeze({ disposition: "delivered-and-delisted", jobId: id, receiptId: receipt.id });
      }
      if (TERMINAL_PHASES.has(data.phase) && (await guard.isClaimedJob(id))) {
        await onEvent({ type: "pilot-terminal", jobId: id, phase: data.phase });
        await stop();
        return Object.freeze({ disposition: "terminal", jobId: id, phase: data.phase });
      }
      return Object.freeze({ disposition: "ignored", jobId: id });
    } catch (error) {
      await onEvent({ type: "pilot-refusal", jobId: id, reason: error instanceof Error ? error.message : String(error) });
      if (id !== null && (await guard.isClaimedJob(id))) await stop();
      return Object.freeze({ disposition: "refused", jobId: id, reason: error instanceof Error ? error.message : String(error) });
    }
  };
}

export async function startVirtualsLiteCommercialPilot({
  apiKey,
  stateRoot,
  operatorWalletAddress = YANAGI_OPERATOR_WALLET,
  forbiddenOperatorWallets = [],
  fetchImpl = fetch,
  ioFactory = defaultIo,
  socketOrigin = VIRTUALS_LITE_SOCKET_ORIGIN,
  onEvent = async () => {},
}) {
  if (socketOrigin !== VIRTUALS_LITE_SOCKET_ORIGIN) throw new TypeError("Virtuals Lite pilot refuses a non-official socket origin");
  const guard = await createVirtualsCommercialPilotGuard({ operatorWalletAddress, stateRoot, forbiddenOperatorWallets });
  const client = createVirtualsLiteApiClient({ apiKey, fetchImpl });
  const publication = await ensureVirtualsLitePilotOffering({ client, guard });
  let socket;
  let stopped = false;
  let resolveCompletion;
  const completion = new Promise((resolveCompletionPromise) => { resolveCompletion = resolveCompletionPromise; });
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    socket?.disconnect();
    resolveCompletion();
  };
  const handle = createVirtualsLitePilotJobHandler({ client, guard, stop, onEvent });
  socket = ioFactory(socketOrigin, {
    auth: { walletAddress: guard.operatorWallet },
    transports: ["websocket"],
  });
  socket.on("roomJoined", (_data, acknowledge) => { if (typeof acknowledge === "function") acknowledge(true); });
  socket.on("onNewTask", (data, acknowledge) => {
    if (typeof acknowledge === "function") acknowledge(true);
    void handle(data);
  });
  socket.on("onEvaluate", (data, acknowledge) => {
    if (typeof acknowledge === "function") acknowledge(true);
    void handle(data);
  });
  socket.on("connect_error", (error) => { void onEvent({ type: "socket-error", reason: error.message }); });
  return Object.freeze({ guard, client, publication, stop, handle, completion });
}
