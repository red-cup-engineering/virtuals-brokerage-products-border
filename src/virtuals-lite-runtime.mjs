import { randomBytes } from "node:crypto";
import { closeSync, constants, existsSync, fsyncSync, linkSync, mkdirSync, openSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { VIRTUALS_PRODUCTS } from "./virtuals-border.mjs";
import { semanticIdOf } from "@red-cup-engineering/computer-data-engineering-services-section/semiotic-expression-notation/semantic-content-identity";

const semanticId = semanticIdOf("brokerage.virtuals-products-border.record");

export const VIRTUALS_LITE_API_ORIGIN = "https://claw-api.virtuals.io";
export const VIRTUALS_LITE_SOCKET_ORIGIN = "https://acpx.virtuals.io";
const TERMINAL_PHASES = new Set([4, 5, 6]);
const ADDRESS = /^0x[0-9a-fA-F]{40}$/u, DECIMAL_ID = /^(?:0|[1-9][0-9]*)$/u;
const nameFor = (product) => `Brokerage API: ${product}`;
const productForName = (name) => Object.keys(VIRTUALS_PRODUCTS).find((product) => name === nameFor(product));
const normalizeAddress = (value, label) => { if (!ADDRESS.test(value ?? "")) throw new TypeError(`${label}-must-be-evm-address`); return value.toLowerCase(); };
const jobId = (value) => { const id = String(value); if (!DECIMAL_ID.test(id)) throw new TypeError("virtuals-job-id-invalid"); return id; };
const providerAvailable = (provider) => typeof provider === "function" && typeof provider.preflight === "function" && typeof provider.originatingActor === "string" && typeof provider.externalEvidence === "function";

function responseBody(response, label) {
  return response.text().then((body) => { let value = null; try { value = body ? JSON.parse(body) : null; } catch { throw new Error(`${label}-returned-non-json`); }
    if (!response.ok) throw new Error(`${label}-failed:${value?.message ?? value?.error ?? response.status}`); return value; });
}
export function createVirtualsLiteBrokerageClient({ apiKey, fetchImpl = fetch, apiOrigin = VIRTUALS_LITE_API_ORIGIN }) {
  if (typeof apiKey !== "string" || apiKey.length < 16 || typeof fetchImpl !== "function" || apiOrigin !== VIRTUALS_LITE_API_ORIGIN) throw new TypeError("virtuals-lite-client-configuration-invalid");
  const call = async (path, method = "GET", body) => {
    if (!path.startsWith("/acp/")) throw new TypeError("virtuals-lite-non-acp-path-refused");
    return responseBody(await fetchImpl(`${apiOrigin}${path}`, { method, redirect: "error", headers: { "x-api-key": apiKey, ...(body === undefined ? {} : { "content-type": "application/json" }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), `${method}:${path}`);
  };
  return Object.freeze({ me: () => call("/acp/me"), publishOffering: (offering) => call("/acp/job-offerings", "POST", { data: offering }),
    accept: (id, payload) => call(`/acp/providers/jobs/${jobId(id)}/accept`, "POST", payload),
    requestPayment: (id, payload) => call(`/acp/providers/jobs/${jobId(id)}/requirement`, "POST", payload),
    deliver: (id, payload) => call(`/acp/providers/jobs/${jobId(id)}/deliverable`, "POST", payload) });
}

export function virtualsBrokerageOfferingDocument(product) {
  const price = VIRTUALS_PRODUCTS[product]; if (!price) throw new TypeError("virtuals-product-unknown");
  return Object.freeze({ name: nameFor(product), description: `One witnessed ${product} from the Brokerage Control API Federation. No buyer-fund custody or brokerage credential crosses this market boundary.`,
    priceV2: { type: "fixed", value: Number(price) }, slaMinutes: 5, requiredFunds: false,
    requirement: { type: "object", additionalProperties: false, properties: { request: { type: "object", description: "Product request; credential-bearing fields are refused." } }, required: ["request"] },
    deliverable: "Content-addressed brokerage product plus witness JSON" });
}

function privateDirectory(path) { if (!existsSync(path)) mkdirSync(path, { recursive: true, mode: 0o700 }); const stat = statSync(path); if (!stat.isDirectory() || (stat.mode & 0o077) !== 0) throw new TypeError("virtuals-state-root-must-be-private"); return path; }
function syncDirectory(path) { const descriptor = openSync(path, constants.O_RDONLY | (constants.O_DIRECTORY ?? 0)); try { fsyncSync(descriptor); } finally { closeSync(descriptor); } }
function createOnly(path, value) {
  privateDirectory(dirname(path)); const temporary = join(dirname(path), `.${process.pid}.${randomBytes(12).toString("hex")}.tmp`); let descriptor;
  try { descriptor = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600); writeFileSync(descriptor, `${JSON.stringify(value)}\n`); fsyncSync(descriptor); }
  finally { if (descriptor !== undefined) closeSync(descriptor); }
  try { linkSync(temporary, path); syncDirectory(dirname(path)); return true; } catch (error) { if (error.code !== "EEXIST") throw error; return false; } finally { unlinkSync(temporary); }
}
const read = (path) => JSON.parse(readFileSync(path, "utf8"));

export function createVirtualsRuntimeState({ stateRoot, now = () => new Date().toISOString() }) {
  const root = privateDirectory(resolve(stateRoot));
  const jobRoot = (id) => privateDirectory(join(root, "jobs", jobId(id)));
  return Object.freeze({ root,
    claim(id, value) { const path = join(jobRoot(id), "claim.json"), candidate = { type: "VirtualsBrokerageJobClaim", version: 1, jobId: jobId(id), requestDigest: semanticId(value.request), product: value.product, offering: value.offering, claimedAt: value.claimedAt };
      if (createOnly(path, candidate)) return candidate; const existing = read(path); if (existing.jobId !== candidate.jobId || existing.requestDigest !== candidate.requestDigest || existing.product !== candidate.product || existing.offering !== candidate.offering) throw new TypeError("virtuals-job-id-bound-to-different-work"); return existing; },
    requireClaim(id) { const path = join(jobRoot(id), "claim.json"); if (!existsSync(path)) throw new TypeError("virtuals-job-claim-required"); return read(path); },
    confirmedEffect(id, effect) { const path = join(jobRoot(id), `${effect}-confirmation.json`); return existsSync(path) ? read(path) : null; },
    async effect(id, effect, payload, perform) {
      const directory = jobRoot(id), attemptPath = join(directory, `${effect}-attempt.json`), confirmationPath = join(directory, `${effect}-confirmation.json`), payloadDigest = semanticId(payload);
      if (existsSync(confirmationPath)) { const confirmation = read(confirmationPath); if (confirmation.payloadDigest !== payloadDigest) throw new TypeError(`virtuals-${effect}-payload-mismatch`); return confirmation; }
      const attempt = { type: "VirtualsBrokerageEffectAttempt", version: 1, jobId: jobId(id), effect, payloadDigest, attemptedAt: now() };
      if (!createOnly(attemptPath, attempt)) throw new TypeError(`virtuals-${effect}-effect-uncertain-refused`);
      const result = await perform(); const confirmation = { type: "VirtualsBrokerageEffectConfirmation", version: 1, jobId: jobId(id), effect, payload, payloadDigest, resultDigest: semanticId(result), confirmedAt: now() };
      if (!createOnly(confirmationPath, confirmation)) throw new TypeError(`virtuals-${effect}-confirmation-conflict`); return confirmation;
    },
    terminal(id, phase) { const path = join(jobRoot(id), "terminal.json"), candidate = { type: "VirtualsBrokerageJobTerminal", version: 1, jobId: jobId(id), phase, recordedAt: now() };
      if (createOnly(path, candidate)) return candidate; const existing = read(path); if (existing.jobId !== candidate.jobId || existing.phase !== phase) throw new TypeError("virtuals-terminal-conflict"); return existing; },
  });
}

function profile(value) { return value?.data?.data ?? value?.data ?? value; }
export async function ensureVirtualsBrokerageOfferings({ client, operatorName, operatorWallet, providers, onEvent = async () => {} }) {
  const expectedWallet = normalizeAddress(operatorWallet, "virtuals-operator-wallet"), current = profile(await client.me());
  if (current?.name !== operatorName || normalizeAddress(current?.walletAddress, "virtuals-profile-wallet") !== expectedWallet) throw new TypeError("virtuals-credential-operator-identity-mismatch");
  const existing = Array.isArray(current.jobs) ? current.jobs : [], dispositions = [];
  for (const product of Object.keys(VIRTUALS_PRODUCTS)) {
    if (!providerAvailable(providers?.[product])) { dispositions.push({ product, disposition: "provider-unavailable" }); continue; }
    const document = virtualsBrokerageOfferingDocument(product), found = existing.find((offering) => offering?.name === document.name);
    if (found) { if (found.priceV2?.type !== "fixed" || Number(found.priceV2.value) !== document.priceV2.value || found.requiredFunds !== false) throw new TypeError("virtuals-existing-offering-incompatible"); dispositions.push({ product, disposition: "already-published" }); }
    else { await client.publishOffering(document); dispositions.push({ product, disposition: "published" }); }
  }
  const receipt = Object.freeze({ type: "VirtualsBrokeragePublicationReceipt", version: 1, operator: operatorName, operatorWallet: expectedWallet, dispositions, recordedAt: new Date().toISOString() });
  await onEvent(receipt); return receipt;
}

function negotiation(data) {
  if (!Array.isArray(data?.memos)) throw new TypeError("virtuals-negotiation-memos-required"); const memo = data.memos.find((candidate) => candidate?.nextPhase === 1);
  if (!memo || typeof memo.content !== "string") throw new TypeError("virtuals-negotiation-memo-required"); let value; try { value = JSON.parse(memo.content); } catch { throw new TypeError("virtuals-negotiation-json-invalid"); }
  const product = productForName(value?.name); if (!product || (value.priceType !== undefined && value.priceType !== "fixed") || !value?.requirement || typeof value.requirement.request !== "object") throw new TypeError("virtuals-negotiation-does-not-match-product");
  return Object.freeze({ product, offering: value.name, request: value.requirement.request });
}

export function createVirtualsPhasedJobHandler({ client, state, operatorWallet, providers, recordDelivery, now = () => new Date().toISOString(), onEvent = async () => {} }) {
  const wallet = normalizeAddress(operatorWallet, "virtuals-operator-wallet"); if (typeof recordDelivery !== "function") throw new TypeError("virtuals-independent-books-required");
  return async function handle(data) {
    const id = jobId(data?.id), negotiated = negotiation(data), expectedPrice = VIRTUALS_PRODUCTS[negotiated.product];
    if (normalizeAddress(data?.providerAddress, "virtuals-job-provider") !== wallet || !Number.isFinite(Number(data.price)) || Number(data.price) !== Number(expectedPrice) || data.requiredFunds === true || data.payableDetail !== undefined) throw new TypeError("virtuals-job-envelope-refused");
    const provider = providers?.[negotiated.product]; if (!providerAvailable(provider)) throw new TypeError("virtuals-product-provider-unavailable");
    if (data.phase === 0) {
      if (data.memoToSign === undefined) return Object.freeze({ disposition: "ignored", jobId: id });
      await provider.preflight(negotiated.request); state.claim(id, { ...negotiated, claimedAt: now() });
      await state.effect(id, "accept", { accept: true, offering: negotiated.offering }, () => client.accept(id, { accept: true, reason: "Brokerage product request admitted by provider preflight" }));
      await state.effect(id, "request-payment", { product: negotiated.product, priceUsdc: expectedPrice }, () => client.requestPayment(id, { content: `${expectedPrice} USDC fixed service fee; no additional funds or custody authority.` }));
      await onEvent({ type: "virtuals-brokerage-payment-requested", jobId: id, product: negotiated.product }); return Object.freeze({ disposition: "payment-requested", jobId: id, product: negotiated.product });
    }
    const claim = state.requireClaim(id); if (claim.requestDigest !== semanticId(negotiated.request) || claim.product !== negotiated.product) throw new TypeError("virtuals-claimed-work-mismatch");
    if (data.phase === 2) {
      const prior = state.confirmedEffect(id, "deliver"); if (prior) return Object.freeze({ disposition: "delivered", jobId: id, product: negotiated.product, output: prior.payload.output, witness: prior.payload.witness, replayedReceipt: true });
      const output = await provider(negotiated.request), recorded = await recordDelivery({ originatingActor: provider.originatingActor, inputs: [negotiated.request], output, externalEvidence: provider.externalEvidence(negotiated.request, output) });
      const witness = recorded.witness ?? recorded, deliverable = { output, witness };
      await state.effect(id, "deliver", { output: output.id, witness: witness.id }, () => client.deliver(id, { deliverable: JSON.stringify(deliverable) }));
      await onEvent({ type: "virtuals-brokerage-delivered", jobId: id, product: negotiated.product, output: output.id, witness: witness.id });
      return Object.freeze({ disposition: "delivered", jobId: id, product: negotiated.product, output: output.id, witness: witness.id });
    }
    if (TERMINAL_PHASES.has(data.phase)) { const terminal = state.terminal(id, data.phase); await onEvent(terminal); return Object.freeze({ disposition: "terminal", jobId: id, phase: data.phase }); }
    return Object.freeze({ disposition: "ignored", jobId: id });
  };
}

export async function startVirtualsBrokerageRuntime({ apiKey, operatorName, operatorWallet, stateRoot, providers, recordDelivery, fetchImpl = fetch, ioFactory, onEvent = async () => {} }) {
  const client = createVirtualsLiteBrokerageClient({ apiKey, fetchImpl }); const state = createVirtualsRuntimeState({ stateRoot });
  const publication = await ensureVirtualsBrokerageOfferings({ client, operatorName, operatorWallet, providers, onEvent });
  const handle = createVirtualsPhasedJobHandler({ client, state, operatorWallet, providers, recordDelivery, onEvent });
  const socketFactory = ioFactory ?? (await import("socket.io-client")).io, socket = socketFactory(VIRTUALS_LITE_SOCKET_ORIGIN, { auth: { walletAddress: normalizeAddress(operatorWallet, "virtuals-operator-wallet") }, transports: ["websocket"] });
  socket.on("roomJoined", (_data, acknowledge) => { if (typeof acknowledge === "function") acknowledge(true); });
  for (const event of ["onNewTask", "onEvaluate"]) socket.on(event, (data, acknowledge) => { if (typeof acknowledge === "function") acknowledge(true); void handle(data).catch((error) => onEvent({ type: "virtuals-brokerage-refusal", reason: error.message, jobId: data?.id ?? null })); });
  socket.on("connect_error", (error) => { void onEvent({ type: "virtuals-brokerage-socket-error", reason: error.message }); });
  return Object.freeze({ client, state, publication, handle, stop: () => socket.disconnect() });
}
