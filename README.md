# Air Disruption Cause Ledger

Air Disruption Cause Ledger is a non-economic GenLayer PROJECT that records evidence-backed disruption-cause signals for individual US domestic flights without claiming an official cause, liability, compensation, refund eligibility, or passenger rights.

## Verified links

- Studionet contract: [`0x999c74695d3f417f01b530d3DE51cC95CE847F7b`](https://explorer-studio.genlayer.com/address/0x999c74695d3f417f01b530d3DE51cC95CE847F7b)
- Deployment transaction: [`0x0bbe13cd...fefb1fd`](https://explorer-studio.genlayer.com/tx/0x0bbe13cdac34e55fb1c3871d045fb1edb32b4b3fbfeb73b619bab32befefb1fd)
- Deployment, lifecycle, and recovery evidence: [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)

The frontend has been verified locally against the release address. A public app URL is not claimed until a later, separately verified Vercel deployment.

## Trust problem

A carrier controls its own explanation while airport/NAS and weather conditions are recorded elsewhere. No single source proves why one flight was disrupted. The contract freezes an exact flight identity and evidence endpoints, asks validators to independently re-run the evidence assessment, and records only a normalized consensus signal.

Missing or conflicting evidence fails safely toward `MIXED_EVIDENCE` or `INSUFFICIENT_EVIDENCE` instead of inventing certainty.

## Why GenLayer is essential

The decision depends on nondeterministic public web evidence from the carrier, FAA/NAS, National Weather Service, and later BTS/ASPM revision material. The Intelligent Contract renders those sources inside GenVM, asks the validator-selected model for a constrained structured classification, and uses GenLayer consensus to decide which result becomes contract state. A conventional deterministic contract cannot fetch and interpret those changing natural-language sources by itself.

## How it works

1. A submitter registers one exact carrier, flight number, date, route, and allowlisted evidence set.
2. Any caller may request the provisional assessment while the case is `REGISTERED`.
3. Validators independently evaluate the frozen sources and agree on one bounded outcome and explanation.
4. A later BTS TranStats or FAA ASPM URL can trigger one revision assessment.
5. Readers load the authoritative current record from the contract. Unsupported retries roll back without changing it.

## Architecture

- `contracts/AirDisruptionCauseLedger.py` is the on-chain source of truth for flight cases, assessments, revision state, source policy, and upgrade authorization.
- `src/` is a React workbench that connects through an explicitly selected browser wallet and `genlayer-js` on Studionet.
- `tests/` is the deterministic contract harness; `src/genlayer.test.ts` covers frontend transaction and reconciliation boundaries.
- `docs/DEPLOYMENT.md` is the deployment, live-proof, upgrade-rehearsal, and recovery manifest.

There is no backend or database. The frontend never substitutes local state for contract readback.

## Intelligent Contract

Actors are the case submitter, assessment callers, GenLayer validators, public readers, and the recorded Studio deployer/upgrader account.

State machine:

```text
REGISTERED (revision 0)
  -> PROVISIONAL_ASSESSED (revision 1)
  -> REVISED_ASSESSED (revision 2)
```

Key methods:

- `register_case` validates identity and category-bound source provenance before storing a case.
- `assess_provisional` evaluates the registered evidence once.
- `assess_revision` evaluates one allowlisted BTS/ASPM revision source after the provisional result.
- `get_case`, `list_case_ids`, and `get_upgrader` expose authoritative readback.
- `upgrade` replaces Root Slot code only for the recorded upgrader and must preserve storage layout.

Outcomes are `CARRIER_REPORTED`, `NAS_CORROBORATED`, `WEATHER_CORROBORATED`, `MIXED_EVIDENCE`, or `INSUFFICIENT_EVIDENCE`. The project transfers no tokens and makes no economic award.

## Transaction lifecycle

- The wallet connection flow opens an explicit provider chooser; it never silently selects the first injected wallet.
- Writes target Studionet, chain ID `61999`, through `https://studio.genlayer.com/api`.
- After signing, the frontend persists the transaction hash, chain, contract, sender, method, arguments, and case ID.
- A write is successful only after explicit `FINALIZED`, `MAJORITY_AGREE`, authoritative `mode=leader` execution `SUCCESS`, and method-specific contract readback.
- Refresh resumes reconciliation; another write is blocked while the pending record is unresolved.
- Contradictory receipt authorities, missing finality, execution errors, or mismatched calldata/readback fail closed. Only a consistent explicit terminal failure clears a retryable pending operation.

## Run locally

Requirements: Node.js 22+ and Python 3.12+.

```powershell
npm install
Copy-Item .env.example .env
```

Set the verified release address in `.env`:

```text
VITE_CONTRACT_ADDRESS=0x999c74695d3f417f01b530d3DE51cC95CE847F7b
```

Never place a placeholder address in a real `.env`.

```powershell
npm run dev
```

## Tests and verification

```powershell
npm test -- --run
npm run build
npm audit --omit=dev

py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
$env:PYTHONUTF8='1'
.\.venv\Scripts\genvm-lint.exe check contracts\AirDisruptionCauseLedger.py
.\.venv\Scripts\python.exe -m pytest -q
```

Verified at the documented release revision:

- Python: `32 passed`
- Vitest: `39 passed` in one tracked file
- GenVM lint: 3 checks passed; semantic validation passed; 7 methods
- Production build: 475 modules transformed successfully
- `npm audit --omit=dev`: 0 vulnerabilities
- Known non-blocking build warning: the main Vite chunk is approximately 723 kB before gzip

## Deployment

- Network: Studionet
- Chain ID: `61999`
- Release contract: `0x999c74695d3f417f01b530d3DE51cC95CE847F7b`
- Deployed contract SHA-256: `058760c040a74af5d1a443ba7501c4f9ef4915b3a29a6652a8370a300f0ff7ab`
- Recorded Studio deployer/upgrader: `0x277bF20771129ae224042d23b0311C1AC5a9AC1b`

The deployed bytes, full live case lifecycle, rollback/no-mutation control, and isolated authorized/unauthorized upgrade rehearsal are recorded in [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md). The disposable rehearsal address is never used by the frontend.

The storage field order `cases`, `case_ids`, `upgrader_address` must not change without an approved migration. Loss of the recorded Studio upgrader account does not recover the old authority; the recovery manifest requires a replacement deployment and repeated live verification.

## Security and trust boundaries

- Carrier URLs are bound to the declared IATA carrier and its canonical hostname.
- FAA evidence accepts only `nasstatus.faa.gov` or `www.faa.gov`.
- Weather evidence accepts only `api.weather.gov` or `www.weather.gov`.
- Revision evidence accepts only `www.transtats.bts.gov` or `www.aspm.faa.gov`.
- HTTPS, hostname, userinfo, port, deceptive-subdomain, category-swap, and carrier/flight-number checks run before state creation.
- Retrieved pages are untrusted evidence; their embedded instructions are explicitly excluded from the model task.
- Receipts and calldata are untrusted protocol boundaries and are checked against the saved operation before readback or retry.

## Known limitations

- The output is a corroboration signal, not an official investigation or legal determination.
- Carrier pages may block automated rendering; unavailable evidence is reported rather than silently replaced.
- FAA NAS data describes system or airport conditions and may not identify the cause of one flight.
- BTS/ASPM data may lag the flight date and may include carrier-reported categories.
- A revision overwrites the current assessment while retaining a revision counter and URL; immutable assessment history is not stored.
- The current frontend bundle carries a non-blocking size warning and has not yet been claimed at a public hosting URL.
- The pinned contract runner matches the verified deployment. A newer advertised runner is not adopted without separate compatibility review and live verification.
