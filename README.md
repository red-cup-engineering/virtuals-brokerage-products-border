# Virtuals brokerage products border

## Source and instance authority boundary

The reusable package ships `src` and `scripts`. The one-job commercial-pilot authorization is a custodian-owned instance input, not a reusable package default or permission granted by installing software. Its existing repository record remains untouched. No account, wallet, credential, permission or deployment is created by this packaging change.

Both `startVirtualsCommercialPilot` and `startVirtualsLiteCommercialPilot` accept `authorizationPath` and forward it to `createVirtualsCommercialPilotGuard`. The guard requires this explicit nonempty path, reads the supplied JSON and preserves every existing enterprise, platform, network, one-job, service-only, exact-price, separate-wallet and forbidden-effect check. Missing or invalid authority refuses before creating guard state. There is no synthesized default authorization. Existing job claims and one-attempt guards remain at the caller's existing `stateRoot`; do not initialize a different root to evade them.

The CLI positional contract is `run-virtuals-commercial-pilot.mjs <state-root> <custodian-authorization-path>`. For backward compatibility, omitting the state-root argument still resolves `data/runtime/virtuals-commercial-pilot` relative to the working directory. Operational receiving must explicitly select the existing state root (and supply the authorization path as the following argument), rather than relying on a new working-directory default. It checks the supplied authorization before authentication or network operations. This documents source inputs, not authorization to run the CLI: its existing authentication/key-generation and external effects still require the applicable permissions.

## Migration and acceptance

Keep the real authorization record and attempt records in their existing custody. The operating owner must bind the existing authorization path explicitly to the existing state root before enabling this version. This source change does not copy or move either. A packaged install without that binding must refuse; installing source is not operational acceptance.

The three existing commercial-pilot test suites retain their behavior/assertions but receive explicitly synthetic test authorization in temporary directories. Their in-memory clients and adapters test policy mechanics only. The synthetic fixture is excluded from the published artifact. The separately named instance-conformance test requires `VIRTUALS_PILOT_INSTANCE_AUTHORIZATION_PATH`; when absent it is skipped and does not count as instance acceptance. It reads/validates but does not mutate the supplied grant or contact a venue. Never supply real grants to source packaging or CI.

Acceptance requires: native packing excludes all instance authorization/state; declared runtime exports remain; missing/invalid authority produces no state or external effects; complete original pilot assertions still pass with synthetic inputs; the operating custodian separately receives the real explicit binding before activation. No live pilot, trade, or financial action is part of source qualification.
