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

## Live acceptance evidence

- Register `ADCL-LIVE-003`: `0x35d11f9602561dbb33d28c9ef0e83d7967699050f0d5da2e062938640f4c11c9`
- Provisional assessment: `0xd85c9f68981657d9ab3a1f7fd0387a919c56bf0403561d93835ea22f8f7a6cf1`
- Revision assessment: `0xc2eec3a912bba5d72be79b45b343a38973f61aa122bb00733bdf5203b6700b8a`
- Replayed revision negative control: `0x400df9d60279d26ee37a955ca96a4c0fe98e0bbc564d67b32fba124c6f6b95fa`

The positive writes finalized with consensus agreement and authoritative leader success. Readback progressed from `REGISTERED` revision `0`, through `PROVISIONAL_ASSESSED` revision `1`, to `REVISED_ASSESSED` revision `2`. The final outcome was `INSUFFICIENT_EVIDENCE`, with `assistance_review_required = true`. The replayed revision finalized with the expected leader rollback and left stage, revision, outcome, source status, explanation, and revision URL unchanged.

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
