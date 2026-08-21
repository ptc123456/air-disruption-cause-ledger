# Deployment and recovery manifest

Status: `STUDIONET LIVE VERIFIED`

## Release deployment

- Network: Studionet
- Chain ID: `61999`
- RPC: `https://studio.genlayer.com/api`
- Contract: `AirDisruptionCauseLedger`
- Contract address: `0x999c74695d3f417f01b530d3DE51cC95CE847F7b`
- Explorer: `https://explorer-studio.genlayer.com/address/0x999c74695d3f417f01b530d3DE51cC95CE847F7b`
- Deployment transaction: `0x0bbe13cdac34e55fb1c3871d045fb1edb32b4b3fbfeb73b619bab32befefb1fd`
- Classification: `UPGRADABLE`
- Constructor argument: `upgrader_address = 0x277bF20771129ae224042d23b0311C1AC5a9AC1b`
- Deployer/upgrader: `0x277bF20771129ae224042d23b0311C1AC5a9AC1b`
- Deployed-source commit: `f70198cb31bd5f4fb85f55c945545431bc76ce79`
- Contract Git blob: `b1ba7aa185acb095deae8cdd3895fca6f7044a1f`
- Contract SHA-256: `058760c040a74af5d1a443ba7501c4f9ef4915b3a29a6652a8370a300f0ff7ab`
- Linked contracts: none

The deployment reached `FINALIZED`, `MAJORITY_AGREE`, and authoritative leader `SUCCESS`. Live deployed-code bytes matched the recorded SHA-256, `get_upgrader` returned the constructor wallet, and the initial case list was empty.

## Steward-remediation upgrade

- Effective source commit: `aa307114c6539962a43b7cc2ab261925181b635d`
- Git tree: `1cf90a4c847b0a63064d56f84754c5583e6abc9f`
- Contract Git blob: `a1c6b387b1f65b8906aebd49a77d64f62e0ae01b`
- Effective contract SHA-256: `63f5e2d86b926b9581ea2cefa0aa611cedda1754f2f06f8488d8022331a55ff5`
- Final upgrade transaction: `0x2d2dfacd666d165145f10b16b3339e4e8a0efb1a76b3100e7357ee5858ca3377`
- Decoded replacement payload: `22,191` bytes with the exact effective contract SHA-256

The final upgrade reached `FINALIZED`, `MAJORITY_AGREE`, and authoritative leader `SUCCESS`. Storage and upgrader readbacks were preserved. The remediation freezes an exact UTC disruption window, classifies every source as `BOUND`, `UNBOUND`, or `UNAVAILABLE`, stores the SHA-256 of every exact bounded rendered snapshot, requires a literal excerpt for each `BOUND` source, and permits only the consensus `BOUND` set to authorize a corroborating outcome.

Validators fetch live pages independently. Snapshot digests and literal excerpts may therefore differ byte-for-byte, and non-authorizing `UNBOUND`/`UNAVAILABLE` availability may differ. Consensus still requires the same outcome, the exact same set of `BOUND` categories, and agreement on material flight/date/route/window/cause facts and evidence limits.

## Production frontend

- Vercel team: `shingg`
- Project: `air-disruption-cause-ledger`
- Canonical URL: `https://air-disruption-cause-ledger.vercel.app`
- Initial manually verified production deployment: `dpl_5VY6Vjo3wuyhDaKL4RfBF7HxUP8o` (`READY`)
- Production variable: `VITE_CONTRACT_ADDRESS = 0x999c74695d3f417f01b530d3DE51cC95CE847F7b`
- Production JS: `assets/index-BZ4J7Jqe.js`
- Production/local bundle SHA-256: `ec97d1bedc00a26ce4a24cc20a9695215fd1c3b0043d9493021995bcaaa7e8b9`

The canonical URL returned HTTP 200, rendered the production UI, and loaded authoritative readback for `ADCL-LIVE-003` at `REVISED_ASSESSED`, revision `2`, outcome `INSUFFICIENT_EVIDENCE`. The remote JS bundle was byte-for-byte equal to the reviewed local production bundle, contained the release contract address, and did not contain the disposable rehearsal address.

Git integration may create later equivalent production deployments, including after documentation-only pushes. Deployment IDs are retained as historical evidence and are not treated as a permanently current identity. The stable production release identity is the canonical URL, exact production asset path and bundle SHA-256, release contract address, and effective live contract readback.

## Live acceptance evidence

- Register `ADCL-LIVE-003`: `0x35d11f9602561dbb33d28c9ef0e83d7967699050f0d5da2e062938640f4c11c9`
- Provisional assessment: `0xd85c9f68981657d9ab3a1f7fd0387a919c56bf0403561d93835ea22f8f7a6cf1`
- Revision assessment: `0xc2eec3a912bba5d72be79b45b343a38973f61aa122bb00733bdf5203b6700b8a`
- Replayed revision negative control: `0x400df9d60279d26ee37a955ca96a4c0fe98e0bbc564d67b32fba124c6f6b95fa`

The positive writes finalized with consensus agreement and authoritative leader success. Readback progressed from `REGISTERED` revision `0`, through `PROVISIONAL_ASSESSED` revision `1`, to `REVISED_ASSESSED` revision `2`. The final outcome was `INSUFFICIENT_EVIDENCE`, with `assistance_review_required = true`. The replayed revision finalized with the expected leader rollback and left stage, revision, outcome, source status, explanation, and revision URL unchanged.

## Steward-remediation live acceptance

Clean evidence case: `ADCL-REMED-002`

- Registration: `0x5df5af70c2d36b238ae05057c42f487ade13923931ff4eaaeb4ae46e01bfe43a`
- Provisional assessment: `0x21c29f59bc6e3f3959fd3ce2f8f97279810bbcb7212a789afc6d5a3a4ea8ed7b`
- Revision assessment: `0xf32aaae70f9a1e7a76f438b0f1ea5cc31d8adf8ef00d6720b2edbb66218cb2b2`
- Revision replay rollback: `0xe793c95318b52256972e1e570d971ca66588ec943e798224846a3f413937ef0c`
- Duplicate-registration rollback: `0xe198471563bf4cf2265b6b76eb6cf2e0248f4551f2fef9f516383d88cc70c52e`

The clean registration froze `DL105`, `ATL` to `LAX`, `2026-08-21`, and `2026-08-21T14:00Z` through `2026-08-21T18:00Z`. Provisional and revision assessments both finalized in round zero with `MAJORITY_AGREE` and successful leader/validator execution. The final readback is `REVISED_ASSESSED`, revision `2`, `INSUFFICIENT_EVIDENCE`, and assistance review required. Carrier was `UNAVAILABLE`; FAA, weather, and the generic BTS revision index were `UNBOUND`. Four lowercase 64-hex snapshot digests were persisted and all non-BOUND excerpts remained empty. The two negative controls finalized with consensus agreement and expected execution errors, leaving the complete result and provenance unchanged.

Complete diagnostic history is retained:

- `0x75019adb11bd7a26d1133837abd60bd1783bfbd5f90ca6cd3e53810a176dc075` registered `ADCL-REMED-001` with a user-entered trailing ` 4.` in the weather URL. It is excluded from the clean lifecycle but remains disclosed.
- `0x608a5f19832433b38fe1ddade6551d71b330f9d056773849872c89ecfd3d346a` finalized `MAJORITY_DISAGREE` after three rotations because exact cross-validator snapshot-byte equality was too strict; no state was written.
- `0x01d34585f857e83d2acf223b4cc341e12df5fdf1cc2c82f6deecdf0945e72f05` finalized `MAJORITY_DISAGREE` after three rotations because all availability status strings were still compared exactly; no state was written.

Each live finding produced a new exact commit, fresh anonymous `PRE_DEPLOY` approval, exact-payload upgrade, and clean retry. Anonymous `POST_DEPLOY_TEST` review approved the final deployed revision and complete attempt history.

## Isolated upgrade rehearsal

- Disposable contract: `0x417C536B31581f52AA007C15456CBb3b3FE0deee`
- Disposable deployment: `0x1f5043aaadbb5a35908dd4e5dda51113a942eb4060053a4ce6e3277ae89286c5`
- Unauthorized wallet: `0x76621EFBDDdCfE6C29f3E6361d32caa468abfDF5`
- Unauthorized upgrade: `0x28c9db2e39218bbd34940484b74e941fcab4ba5b270eb4becce25fc6168294d4`
- Authorized upgrade: `0xa30591a5f1c5b638f856afad2824049edf7a37c244b3d3b951a33d765351a872`

The replacement payload was the complete approved source encoded as `b#<hex>`. Exact calldata parity was verified against the pinned SDK encoding. The unauthorized transaction finalized with consensus agreement and `SystemError: forbidden`; deployed code, upgrader, and state remained unchanged. The authorized transaction finalized with consensus agreement and leader success. Post-upgrade code remained byte-for-byte equal to the approved source, the upgrader was preserved, and the disposable case list remained empty. This address is rehearsal-only and must never be configured in the release frontend.

## Storage compatibility

Never reorder, remove or change the types of these fields: `cases`, `case_ids`, `upgrader_address`. New fields may only be appended after a reviewed migration/compatibility decision.

## Recovery

If Studio/local UI state is reset while chain state remains, reconnect the recorded upgrader wallet, import the contract by its recorded address, load the exact source revision, verify code parity and only then perform any upgrade.

If the recorded Studio deployer/upgrader account becomes unavailable, the existing contract may remain readable but its old upgrade authority cannot be recovered or replaced through that lost account. Deploy a replacement from the recorded source and constructor manifest, restore every configuration and link, repeat the full live test suite, then update the frontend and all documentation references. Do not claim that the original contract remains recoverably upgradable.

If Studionet chain state is reset, the address and state cannot be recovered. Redeploy the recorded source with the same upgrader choice, repeat all live tests, update the frontend address and replace every deployment reference.

The isolated rehearsal above proves both authorized replacement and unauthorized rejection without mutating the release deployment.
