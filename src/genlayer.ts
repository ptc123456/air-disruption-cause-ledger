import { createClient } from 'genlayer-js'
import { studionet } from 'genlayer-js/chains'
import { TransactionStatus } from 'genlayer-js/types'
import type { TransactionHash } from 'genlayer-js/types'
import type { EthereumProvider, FlightCase, HexAddress, WalletOption } from './types'

const contractAddress = import.meta.env.VITE_CONTRACT_ADDRESS as HexAddress | undefined
const readClient = createClient({ chain: studionet })
const PENDING_KEY = 'adcl.pending-write.v1'
const STUDIONET_CHAIN_ID = 61999

export interface PendingOperation {
  version: 1
  hash: TransactionHash
  chainId: 61999
  contract: HexAddress
  sender: HexAddress
  functionName: string
  args: string[]
  caseId: string
}

interface PendingStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

interface ReconcileDependencies {
  getTransaction(hash: TransactionHash): Promise<unknown>
  waitForFinalized(hash: TransactionHash): Promise<unknown>
  readCase(caseId: string): Promise<FlightCase | null>
  clear(): void
}

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
  if (loadPendingOperation()) {
    throw new Error('A saved transaction must be reconciled before another write can be submitted.')
  }
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
  const pending: PendingOperation = {
    version: 1,
    hash,
    chainId: STUDIONET_CHAIN_ID,
    contract: configuredContractAddress(),
    sender: account,
    functionName,
    args,
    caseId: caseId.trim().toUpperCase(),
  }
  savePendingOperation(pending)
  onStatus('Submitted; waiting for FINALIZED', hash)
  return reconcilePendingOperation(pending, onStatus)
}

export function loadPendingOperation(storage: PendingStorage = window.localStorage): PendingOperation | null {
  const raw = storage.getItem(PENDING_KEY)
  if (!raw) return null
  try {
    const value = JSON.parse(raw) as Partial<PendingOperation>
    if (
      value.version !== 1 || value.chainId !== STUDIONET_CHAIN_ID
      || typeof value.hash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(value.hash)
      || typeof value.contract !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(value.contract)
      || typeof value.sender !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(value.sender)
      || typeof value.functionName !== 'string' || !Array.isArray(value.args)
      || !value.args.every((arg) => typeof arg === 'string') || typeof value.caseId !== 'string'
    ) return null
    return value as PendingOperation
  } catch {
    return null
  }
}

export function savePendingOperation(pending: PendingOperation, storage: PendingStorage = window.localStorage): void {
  storage.setItem(PENDING_KEY, JSON.stringify(pending))
}

export function clearPendingOperation(storage: PendingStorage = window.localStorage): void {
  storage.removeItem(PENDING_KEY)
}

export function pendingMatchesContext(
  pending: PendingOperation,
  account: HexAddress,
  address: HexAddress = configuredContractAddress(),
): boolean {
  return pending.chainId === STUDIONET_CHAIN_ID
    && pending.sender.toLowerCase() === account.toLowerCase()
    && pending.contract.toLowerCase() === address.toLowerCase()
}

export async function reconcilePendingOperation(
  pending: PendingOperation,
  onStatus: (status: string, hash?: string) => void,
  dependencies?: ReconcileDependencies,
): Promise<FlightCase> {
  const deps = dependencies || {
    getTransaction: (hash: TransactionHash) => readClient.getTransaction({ hash }),
    waitForFinalized: (hash: TransactionHash) => readClient.waitForTransactionReceipt({
      hash,
      status: TransactionStatus.FINALIZED,
      interval: 5_000,
      retries: 120,
    }),
    readCase,
    clear: clearPendingOperation,
  }
  onStatus('Reconciling saved transaction', pending.hash)
  await deps.getTransaction(pending.hash)
  const receipt = await deps.waitForFinalized(pending.hash)
  try {
    assertSuccessfulReceipt(receipt)
  } catch (reason) {
    if (isExplicitFinalFailure(receipt)) deps.clear()
    throw reason
  }
  onStatus('FINALIZED and execution successful; reading contract', pending.hash)
  const record = await deps.readCase(pending.caseId)
  if (!record) throw new Error('Transaction finalized, but authoritative contract readback is missing; reconciliation remains pending.')
  deps.clear()
  onStatus('Readback confirmed', pending.hash)
  return record
}

export function assertSuccessfulReceipt(receipt: unknown): void {
  if (!receipt || typeof receipt !== 'object') throw new Error('Missing finalized receipt.')
  const value = receipt as {
    statusName?: string
    status_name?: string
    resultName?: string
    result_name?: string
    txExecutionResultName?: string
    consensus_data?: { leader_receipt?: Array<{ execution_result?: string }> }
  }
  if ((value.statusName ?? value.status_name) !== 'FINALIZED') {
    throw new Error('Receipt does not confirm FINALIZED status.')
  }
  const consensus = value.resultName ?? value.result_name
  const leaderSucceeded = value.txExecutionResultName === 'FINISHED_WITH_RETURN'
    || value.consensus_data?.leader_receipt?.some((entry) => entry.execution_result === 'SUCCESS') === true
  if (consensus !== 'MAJORITY_AGREE' || !leaderSucceeded) {
    throw new Error('Finalized transaction did not confirm successful leader execution.')
  }
}

function isExplicitFinalFailure(receipt: unknown): boolean {
  if (!receipt || typeof receipt !== 'object') return false
  const value = receipt as {
    statusName?: string
    status_name?: string
    resultName?: string
    result_name?: string
    txExecutionResultName?: string
    consensus_data?: { leader_receipt?: Array<{ execution_result?: string }> }
  }
  if ((value.statusName ?? value.status_name) !== 'FINALIZED') return false
  const consensus = value.resultName ?? value.result_name
  const executions = value.consensus_data?.leader_receipt?.map((entry) => entry.execution_result) ?? []
  return consensus === 'MAJORITY_DISAGREE'
    || consensus === 'NO_MAJORITY'
    || value.txExecutionResultName === 'FINISHED_WITH_ERROR'
    || (executions.length > 0 && executions.every((result) => result === 'ERROR' || result === 'idle'))
}
