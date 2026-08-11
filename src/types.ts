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

export interface FlightCase {
  case_id: string
  submitter: string
  carrier: string
  flight_number: string
  flight_date: string
  origin: string
  destination: string
  carrier_url: string
  faa_url: string
  weather_url: string
  revision_url: string
  stage: 'REGISTERED' | 'PROVISIONAL_ASSESSED' | 'REVISED_ASSESSED'
  outcome: string
  explanation: string
  source_status: string
  assistance_review_required: boolean
  revision: number
}

declare global {
  interface Window {
    ethereum?: EthereumProvider
  }
}
