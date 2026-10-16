// Synthetic guard-mechanics input. This is not an operational authorization.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
export function syntheticAuthorizationPath(directory, overrides = {}) {
  const path = join(directory, "synthetic-pilot-authorization.json");
  writeFileSync(path, JSON.stringify({
    testFixture: true,
    enterprise: "urn:ame:blockchain-trashpanda", platform: "Virtuals ACP",
    network: "eip155:8453", jobLimit: 1, jobType: "service-only",
    exactPrice: { amount: "0.01", currency: "USDC" },
    operatorWallet: { separation: "new-and-separate" },
    forbiddenEffects: ["fund-transfer-job", "broader-launch"], ...overrides,
  }));
  return path;
}
