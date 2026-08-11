import { createClient } from 'genlayer-js'
import { studionet } from 'genlayer-js/chains'
import { TransactionStatus } from 'genlayer-js/types'
import type { EthereumProvider, FlightCase, HexAddress, WalletOption } from './types'

const contractAddress = import.meta.env.VITE_CONTRACT_ADDRESS as HexAddress | undefined
const readClient = createClient({ chain: studionet })

export function configuredContractAddress(): HexAddress {
  if (!contractAddress || !/^0x[0-9a-fA-F]{40}$/.test(contractAddress)) {
    throw new Error('No valid VITE_CONTRACT_ADDRESS is configured. Deploy first, then set the real address.')
  }
  return contractAddress
}

export function collectWallets(onChange: (wallets: WalletOption[]) => void): () => void {
  const found = new Map<string, WalletOption>()
  const announce = (event: Event) => {
    const detail = (event as CustomEvent).detail as {
      info?: { uuid?: string; name?: string; icon?: string }
      provider?: EthereumProvider
    }
    if (!detail?.provider) return
    const id = detail.info?.uuid || detail.info?.name || `provider-${found.size + 1}`
    found.set(id, {
      id,
      name: detail.info?.name || 'Browser wallet',
      icon: detail.info?.icon,
      provider: detail.provider,
    })
    onChange([...found.values()])
  }

  window.addEventListener('eip6963:announceProvider', announce)
  window.dispatchEvent(new Event('eip6963:requestProvider'))
  const fallback = window.setTimeout(() => {
    if (found.size === 0 && window.ethereum) {
      found.set('legacy-injected', { id: 'legacy-injected', name: 'Injected wallet', provider: window.ethereum })
      onChange([...found.values()])
    }
  }, 250)

  return () => {
    window.clearTimeout(fallback)
    window.removeEventListener('eip6963:announceProvider', announce)
  }
}

export async function requestWallet(option: WalletOption): Promise<HexAddress> {
  const accounts = (await option.provider.request({ method: 'eth_requestAccounts' })) as string[]
  const address = accounts?.[0]
  if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address)) throw new Error('The selected wallet returned no valid account.')
  return address as HexAddress
}

export async function readCase(caseId: string): Promise<FlightCase | null> {
  const result = await readClient.readContract({
    address: configuredContractAddress(),
    functionName: 'get_case',
    args: [caseId.trim().toUpperCase()],
  })
  if (typeof result !== 'string' || result === '') return null
  return JSON.parse(result) as FlightCase
}

export async function writeAndReadback(
  provider: EthereumProvider,
  account: HexAddress,
  functionName: string,
  args: string[],
  caseId: string,
  onStatus: (status: string, hash?: string) => void,
): Promise<FlightCase> {
  const client = createClient({ chain: studionet, account, provider })
  onStatus('Requesting Studionet network')
  await client.connect('studionet')
  onStatus('Awaiting signature')
  const hash = await client.writeContract({
    address: configuredContractAddress(),
    functionName,
    args,
    value: BigInt(0),
  })
  onStatus('Submitted; waiting for FINALIZED', hash)
  const receipt = await readClient.waitForTransactionReceipt({
    hash,
    status: TransactionStatus.FINALIZED,
    interval: 5_000,
    retries: 120,
  })
  assertSuccessfulReceipt(receipt)
  onStatus('FINALIZED and execution successful; reading contract', hash)
  const record = await readCase(caseId)
  if (!record) throw new Error('Transaction finalized, but authoritative contract readback is missing.')
  onStatus('Readback confirmed', hash)
  return record
}

export function assertSuccessfulReceipt(receipt: unknown): void {
  if (!receipt || typeof receipt !== 'object') throw new Error('Missing finalized receipt.')
  const value = receipt as {
    statusName?: string
    resultName?: string
    txExecutionResultName?: string
    consensus_data?: { final?: boolean }
  }
  if (value.statusName !== 'FINALIZED' && value.consensus_data?.final !== true) {
    throw new Error('Receipt does not confirm FINALIZED status.')
  }
  if (value.resultName !== 'SUCCESS' || value.txExecutionResultName !== 'FINISHED_WITH_RETURN') {
    throw new Error('Finalized transaction did not confirm successful leader execution.')
  }
}
