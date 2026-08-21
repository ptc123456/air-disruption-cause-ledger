export type HexAddress = `0x${string}`

export interface EthereumProvider {
  request(args: { method: string; params?: unknown[] | Record<string, unknown> }): Promise<unknown>
  on?(event: string, listener: (...args: unknown[]) => void): void
  removeListener?(event: string, listener: (...args: unknown[]) => void): void
}

export interface WalletOption {
  id: string
  name: string
  icon?: string
  provider: EthereumProvider
}

export type SourceBindingStatus = 'BOUND' | 'UNBOUND' | 'UNAVAILABLE'

export interface FlightCase {
  case_id: string
  submitter: string
  carrier: string
  flight_number: string
  flight_date: string
  origin: string
  destination: string
  window_start_utc?: string
  window_end_utc?: string
  carrier_url: string
  faa_url: string
  weather_url: string
  revision_url: string
  stage: 'REGISTERED' | 'PROVISIONAL_ASSESSED' | 'REVISED_ASSESSED'
  outcome: string
  explanation: string
  source_status: string
  source_bindings?: Record<string, SourceBindingStatus>
  evidence_digests?: Record<string, string>
  grounded_excerpts?: Record<string, string>
  assistance_review_required: boolean
  revision: number
}

declare global {
  interface Window {
    ethereum?: EthereumProvider
  }
}
