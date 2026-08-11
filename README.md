# Air Disruption Cause Ledger

Air Disruption Cause Ledger is a non-economic GenLayer PROJECT for recording evidence-backed disruption-cause signals for individual US domestic flights. It does **not** determine an official cause, legal liability, compensation, refund eligibility, or passenger rights.

## Trust problem

A carrier controls its own explanation while airport/NAS and weather conditions are recorded elsewhere. No single source proves why one flight was disrupted. The Intelligent Contract freezes an exact flight identity and evidence endpoints, asks validators to independently re-run the evidence assessment, and records only a normalized consensus signal.

Outcomes are `CARRIER_REPORTED`, `NAS_CORROBORATED`, `WEATHER_CORROBORATED`, `MIXED_EVIDENCE`, or `INSUFFICIENT_EVIDENCE`. Missing or conflicting evidence fails safely to the last two outcomes rather than inventing certainty.

## Architecture

- `contracts/AirDisruptionCauseLedger.py` — authoritative flight cases, assessment, revisions, and review-routing state.
- `src/` — React workbench using `genlayer-js` against Studionet.
- `tests/` — deterministic contract validation harness.

There is no backend or database. Reads come from the contract. Writes wait for `FINALIZED`, require successful execution, and then perform authoritative readback.

The contract is classified `UPGRADABLE`. Deployment requires an explicit non-zero, user-controlled external wallet constructor argument. Root Slot code replacement remains protected by GenVM's upgrader authorization; the storage field order must remain unchanged across upgrades.

## Local setup

Requirements: Node.js 22+ and Python 3.12+.

```powershell
npm install
npm test
npm run build

py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
.\.venv\Scripts\genvm-lint.exe check contracts\AirDisruptionCauseLedger.py
.\.venv\Scripts\python.exe -m pytest -q
```

Copy `.env.example` to `.env` only after a real deployment exists, then set:

```text
VITE_CONTRACT_ADDRESS=<real Studionet address>
```

Never place a placeholder address in `.env`.

## Network and transaction behavior

- Network: Studionet
- RPC: `https://studio.genlayer.com/api`
- Chain ID: `61999`
- Wallet connection always opens an explicit provider selector.
- The UI does not treat a hash or `ACCEPTED` status as success.
- After submission, the UI persists the hash, chain, contract, sender, method, arguments, and case ID. A refresh resumes reconciliation through `getTransaction`, exact `FINALIZED` receipt checks, and authoritative readback; another write is blocked while that record remains unresolved.

## Evidence provenance

FAA evidence accepts only `nasstatus.faa.gov` or `www.faa.gov`; weather evidence accepts only `api.weather.gov` or `www.weather.gov`; revision evidence accepts only BTS TranStats or FAA ASPM. Carrier evidence is bound to the declared IATA code and its canonical hostname: AA/aa.com, AS/alaskaair.com, B6/jetblue.com, DL/delta.com, F9/flyfrontier.com, G4/allegiantair.com, HA/hawaiianairlines.com, NK/spirit.com, UA/united.com, or WN/southwest.com. Userinfo, ports, deceptive subdomains, category swaps, and carrier/flight-number mismatches fail before state creation.

## Evidence limits

FAA NAS data describes system and airport conditions and does not investigate the cause of an individual flight delay. BTS/ASPM material may be delayed and may incorporate carrier-reported categories. The project therefore records a corroboration signal, not an official finding. A revision overwrites the current assessment while retaining the revision counter and revision URL; it does not preserve immutable assessment history.

## Release status

Current stage: local implementation. No contract address, GitHub repository, or live deployment is claimed yet.

The deterministic pytest harness covers input and state transitions without pretending to simulate validators. Web/LLM consensus and validator disagreement remain mandatory Studionet evidence before deployment readiness.

The contract runner pin matches the current official FetchWebContent example. The linter may advertise a newer runner whose SDK artifact is not yet loadable by `genvm-linter 0.11.0`; that suggestion is not treated as a validated upgrade.
