import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { startVirtualsLiteCommercialPilot } from "../src/virtuals-lite-commercial-pilot.mjs";
import { startVirtualsCommercialPilot } from "../src/virtuals-commercial-pilot-runtime.mjs";

test("Lite startup refuses missing authority before API, socket or state effects", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "virtuals-callers-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const stateRoot = join(root, "state");
  let effects = 0;
  await assert.rejects(startVirtualsLiteCommercialPilot({ stateRoot, apiKey: "synthetic-key", fetchImpl: () => { effects++; throw Error("unexpected network"); }, ioFactory: () => { effects++; throw Error("unexpected socket"); } }), /explicit authorizationPath/u);
  assert.equal(effects, 0);
  assert.equal(existsSync(stateRoot), false);
});

test("SDK startup refuses missing authority before adapter or key-custody initialization", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "virtuals-callers-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const stateRoot = join(root, "state");
  await assert.rejects(startVirtualsCommercialPilot({ stateRoot, walletAddress: "0x1111111111111111111111111111111111111111" }), /explicit authorizationPath/u);
  assert.equal(existsSync(stateRoot), false);
});
