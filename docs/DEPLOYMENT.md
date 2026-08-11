# Deployment and recovery manifest

Status: `DRAFT — NOT DEPLOYED`

## Intended deployment

- Network: Studionet
- Chain ID: `61999`
- RPC: `https://studio.genlayer.com/api`
- Contract: `AirDisruptionCauseLedger`
- Classification: `UPGRADABLE`
- Constructor argument: `upgrader_address = 0x277bF20771129ae224042d23b0311C1AC5a9AC1b`
- Selected deployer/upgrader: `0x277bF20771129ae224042d23b0311C1AC5a9AC1b` (valid EIP-55 checksum; user-selected; active-wallet verification still required immediately before deployment)
- Linked contracts: none

The final contract address, Explorer URL, deployment transaction, exact Git commit and contract SHA-256 must be recorded only after successful deployment and authoritative readback.

## Storage compatibility

Never reorder, remove or change the types of these fields: `cases`, `case_ids`, `upgrader_address`. New fields may only be appended after a reviewed migration/compatibility decision.

## Recovery

If Studio/local UI state is reset while chain state remains, reconnect the recorded upgrader wallet, import the contract by its recorded address, load the exact source revision, verify code parity and only then perform any upgrade.

If Studionet chain state is reset, the address and state cannot be recovered. Redeploy the recorded source with the same upgrader choice, repeat all live tests, update the frontend address and replace every deployment reference.

Before production wiring, rehearse an upgrade on a disposable deployment and prove that the authorized upgrader succeeds while an unrelated wallet is rejected.
