import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createVirtualsCommercialPilotGuard, readVirtualsPilotAuthorization } from "../src/virtuals-commercial-pilot-guard.mjs";
import { syntheticAuthorizationPath } from "./fixtures/synthetic-pilot-authorization.mjs";

const operatorWalletAddress = "0x1111111111111111111111111111111111111111";
test("missing, absent and invalid instance authority refuse before state creation", async () => {
  const root = mkdtempSync(join(tmpdir(), "virtuals-boundary-"));
  for (const authorizationPath of [undefined, "", join(root, "absent.json"), syntheticAuthorizationPath(root, { jobLimit: 2 })]) {
    const stateRoot = join(root, "not-created");
    await assert.rejects(createVirtualsCommercialPilotGuard({ operatorWalletAddress, stateRoot, authorizationPath }), /authorization/u);
    assert.equal(existsSync(stateRoot), false);
  }
});

test("synthetic authority mechanics preserve the supplied file bytes", async () => {
  const root = mkdtempSync(join(tmpdir(), "virtuals-boundary-"));
  const authorizationPath = syntheticAuthorizationPath(root);
  const before = readFileSync(authorizationPath);
  const authority = await readVirtualsPilotAuthorization(authorizationPath);
  assert.equal(authority.testFixture, true);
  await createVirtualsCommercialPilotGuard({ operatorWalletAddress, stateRoot: join(root, "state"), authorizationPath });
  assert.deepEqual(readFileSync(authorizationPath), before);
});

// Separately enrolled by the custodian. This test is deliberately NOT fixture evidence.
test("instance conformance: custodian-supplied original grant satisfies the unchanged policy", {
  skip: !process.env.VIRTUALS_PILOT_INSTANCE_AUTHORIZATION_PATH && "explicit custodian grant input not provided",
}, async () => {
  const authorization = await readVirtualsPilotAuthorization(process.env.VIRTUALS_PILOT_INSTANCE_AUTHORIZATION_PATH);
  assert.notEqual(authorization.testFixture, true, "a synthetic fixture cannot qualify real instance authority");
});
