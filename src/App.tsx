import { FormEvent, useEffect, useRef, useState } from 'react'
import { collectWallets, readCase, requestWallet, writeAndReadback } from './genlayer'
import type { FlightCase, HexAddress, WalletOption } from './types'

const EMPTY = {
  caseId: '', carrier: '', flightNumber: '', flightDate: '', origin: '', destination: '',
  carrierUrl: '', faaUrl: 'https://nasstatus.faa.gov/', weatherUrl: 'https://api.weather.gov/',
}

function field(form: FormData, name: string): string {
  return String(form.get(name) || '').trim()
}

export default function App() {
  const [wallets, setWallets] = useState<WalletOption[]>([])
  const [wallet, setWallet] = useState<WalletOption | null>(null)
  const [account, setAccount] = useState<HexAddress | null>(null)
  const [activeCase, setActiveCase] = useState<FlightCase | null>(null)
  const [caseId, setCaseId] = useState('')
  const [status, setStatus] = useState('Ready')
  const [txHash, setTxHash] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const walletDialog = useRef<HTMLDialogElement>(null)

  useEffect(() => collectWallets(setWallets), [])
  useEffect(() => {
    if (!wallet) return
    const accountsChanged = (...values: unknown[]) => {
      const accounts = values[0] as string[] | undefined
      const next = accounts?.[0]
      if (!next || !/^0x[0-9a-fA-F]{40}$/.test(next)) {
        setAccount(null)
        setWallet(null)
        setStatus('Wallet disconnected')
        return
      }
      setAccount(next as HexAddress)
      setStatus('Wallet account changed')
    }
    const chainChanged = () => setStatus('Wallet network changed; Studionet will be requested before the next write')
    wallet.provider.on?.('accountsChanged', accountsChanged)
    wallet.provider.on?.('chainChanged', chainChanged)
    return () => {
      wallet.provider.removeListener?.('accountsChanged', accountsChanged)
      wallet.provider.removeListener?.('chainChanged', chainChanged)
    }
  }, [wallet])

  async function connect(option: WalletOption) {
    setError('')
    try {
      const address = await requestWallet(option)
      setWallet(option)
      setAccount(address)
      walletDialog.current?.close()
    } catch (reason) {
      setError(message(reason))
    }
  }

  async function load(id = caseId) {
    setError('')
    setStatus('Reading contract')
    try {
      const record = await readCase(id)
      setActiveCase(record)
      setCaseId(id.trim().toUpperCase())
      setStatus(record ? 'Readback loaded' : 'Case not found')
    } catch (reason) {
      setError(message(reason))
      setStatus('Read failed')
    }
  }

  async function write(functionName: string, args: string[], id: string) {
    if (!wallet || !account) {
      walletDialog.current?.showModal()
      return
    }
    setBusy(true)
    setError('')
    setTxHash('')
    try {
      const record = await writeAndReadback(wallet.provider, account, functionName, args, id, (next, hash) => {
        setStatus(next)
        if (hash) setTxHash(hash)
      })
      setActiveCase(record)
      setCaseId(id)
    } catch (reason) {
      setError(message(reason))
      setStatus('Write not confirmed')
    } finally {
      setBusy(false)
    }
  }

  function register(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const id = field(data, 'caseId').toUpperCase()
    void write('register_case', [
      id,
      field(data, 'carrier').toUpperCase(),
      field(data, 'flightNumber').toUpperCase(),
      field(data, 'flightDate'),
      field(data, 'origin').toUpperCase(),
      field(data, 'destination').toUpperCase(),
      field(data, 'carrierUrl'),
      field(data, 'faaUrl'),
      field(data, 'weatherUrl'),
    ], id)
  }

  function revise(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const revisionUrl = field(new FormData(event.currentTarget), 'revisionUrl')
    if (activeCase) void write('assess_revision', [activeCase.case_id, revisionUrl], activeCase.case_id)
  }

  return (
    <>
      <header className="topbar">
        <a className="wordmark" href="#workbench">ADCL / STUDIONET</a>
        <nav aria-label="Primary">
          <a href="#register">Register</a>
          <a href="#ledger">Ledger</a>
        </nav>
        <div className="wallet-controls">
          <button className="wallet-button" type="button" onClick={() => walletDialog.current?.showModal()}>
            {account ? `Switch · ${account.slice(0, 6)}…${account.slice(-4)}` : 'Connect wallet'}
          </button>
          {account && <button type="button" onClick={() => { setAccount(null); setWallet(null); setStatus('Wallet disconnected') }}>Disconnect</button>}
        </div>
      </header>

      <main id="workbench">
        <section className="intro" aria-labelledby="title">
          <p className="system-line">Evidence signal—not legal liability, compensation, or an official cause.</p>
          <h1 id="title">Trace what disrupted the flight.</h1>
          <p>Freeze a flight identity, compare carrier claims with FAA and weather evidence, and retain every assessed revision on GenLayer.</p>
        </section>

        <section className="workbench" id="register" aria-labelledby="register-title">
          <div className="frame-heading">
            <span>01 / INPUT</span>
            <h2 id="register-title">Register one exact flight</h2>
          </div>
          <form className="flight-form" onSubmit={register} aria-busy={busy}>
            <Input name="caseId" label="Case ID" placeholder="DL-105-2026-08-11-ATL-LAX" required />
            <Input name="carrier" label="Operating carrier code" placeholder="DL" required maxLength={8} />
            <Input name="flightNumber" label="Flight number" placeholder="DL105" required maxLength={12} />
            <Input name="flightDate" label="Flight date" type="date" required />
            <Input name="origin" label="Origin IATA" placeholder="ATL" required maxLength={3} />
            <Input name="destination" label="Destination IATA" placeholder="LAX" required maxLength={3} />
            <Input name="carrierUrl" label="Carrier flight-status URL" placeholder="https://airline.example/flight-status" type="url" required wide />
            <Input name="faaUrl" label="FAA NAS evidence URL" defaultValue={EMPTY.faaUrl} type="url" required wide />
            <Input name="weatherUrl" label="NWS evidence URL" defaultValue={EMPTY.weatherUrl} type="url" required wide />
            <button className="primary-action" type="submit" disabled={busy}>
              {busy ? 'Transaction in progress…' : 'Register on Studionet'}
            </button>
          </form>
        </section>

        <section className="workbench" id="ledger" aria-labelledby="ledger-title">
          <div className="frame-heading">
            <span>02 / READBACK</span>
            <h2 id="ledger-title">Open the authoritative ledger</h2>
          </div>
          <form className="case-search" onSubmit={(event) => { event.preventDefault(); void load() }}>
            <label htmlFor="case-search">Case ID</label>
            <div>
              <input id="case-search" value={caseId} onChange={(event) => setCaseId(event.target.value)} placeholder="DL-105-2026-08-11-ATL-LAX" required />
              <button type="submit">Load case</button>
            </div>
          </form>

          <div className="transaction-strip" role="status" aria-live="polite">
            <span className={error ? 'signal error' : busy ? 'signal busy' : 'signal'} aria-hidden="true" />
            <div><strong>{status}</strong>{txHash && <code>{txHash}</code>}</div>
          </div>
          {error && <p className="error-message" role="alert">{error}</p>}

          {activeCase ? <CasePanel record={activeCase} busy={busy} assess={() => void write('assess_provisional', [activeCase.case_id], activeCase.case_id)} revise={revise} /> : (
            <div className="empty-state"><strong>No case loaded.</strong><p>Enter an exact Case ID or register a new flight above.</p></div>
          )}
        </section>
      </main>

      <footer><p>Evidence can corroborate a signal. It cannot turn uncertainty into fact.</p><span>Air Disruption Cause Ledger · Studionet</span></footer>

      <dialog ref={walletDialog} className="wallet-dialog" onClick={(event) => { if (event.target === walletDialog.current) walletDialog.current.close() }}>
        <h2>Choose a wallet</h2>
        <p>Connection is requested only after you choose a provider.</p>
        <div className="wallet-list">
          {wallets.map((option) => <button key={option.id} type="button" onClick={() => void connect(option)}>{option.icon && <img src={option.icon} alt="" width="28" height="28" />}<span>{option.name}</span></button>)}
          {wallets.length === 0 && <p>No injected wallet provider was detected.</p>}
        </div>
        <form method="dialog" className="dialog-close"><button type="submit" aria-label="Close wallet selector">Close</button></form>
      </dialog>
    </>
  )
}

function Input({ name, label, wide = false, ...props }: { name: string; label: string; wide?: boolean } & React.InputHTMLAttributes<HTMLInputElement>) {
  return <label className={wide ? 'field wide' : 'field'}><span>{label}</span><input name={name} {...props} /><small aria-live="polite" /></label>
}

function CasePanel({ record, busy, assess, revise }: { record: FlightCase; busy: boolean; assess: () => void; revise: (event: FormEvent<HTMLFormElement>) => void }) {
  return <article className="case-panel">
    <div className="flight-identity"><div><span>{record.carrier}</span><strong>{record.flight_number}</strong></div><p><b>{record.origin}</b><i aria-hidden="true">→</i><b>{record.destination}</b></p><time>{record.flight_date}</time></div>
    <dl className="case-meta"><div><dt>Stage</dt><dd>{record.stage}</dd></div><div><dt>Revision</dt><dd>{record.revision}</dd></div><div><dt>Review route</dt><dd>{record.assistance_review_required ? 'REQUIRED' : 'NOT FLAGGED'}</dd></div></dl>
    {record.outcome && <section className="verdict"><span>CONSENSUS SIGNAL</span><h3>{record.outcome.replaceAll('_', ' ')}</h3><p>{record.explanation}</p><small>{record.source_status}</small></section>}
    <div className="source-ledger">
      <h3>Frozen evidence endpoints</h3>
      {[['Carrier', record.carrier_url], ['FAA / NAS', record.faa_url], ['Weather', record.weather_url], ...(record.revision_url ? [['Revision', record.revision_url]] : [])].map(([label, url]) => <a key={label} href={url} target="_blank" rel="noreferrer"><span>{label}</span><code>{url}</code></a>)}
    </div>
    {record.stage === 'REGISTERED' && <button type="button" className="primary-action" onClick={assess} disabled={busy}>{busy ? 'Assessing…' : 'Run provisional assessment'}</button>}
    {record.stage === 'PROVISIONAL_ASSESSED' && <form className="revision-form" onSubmit={revise}><Input name="revisionUrl" label="BTS TranStats or FAA ASPM revision URL" type="url" required wide /><button className="primary-action" type="submit" disabled={busy}>{busy ? 'Assessing…' : 'Assess revision'}</button></form>}
  </article>
}

function message(reason: unknown): string {
  return reason instanceof Error ? reason.message : 'Unexpected operation failure.'
}
