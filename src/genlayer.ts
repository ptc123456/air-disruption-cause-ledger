import { abi, createClient } from 'genlayer-js'
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
  return reconcilePendingOperation(pending, account, onStatus)
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
  account: HexAddress,
  onStatus: (status: string, hash?: string) => void,
  dependencies?: ReconcileDependencies,
  activeContract: HexAddress = configuredContractAddress(),
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
  if (!pendingMatchesContext(pending, account, activeContract)) {
    throw new Error('Saved transaction does not match the active sender, contract, or Studionet context.')
  }
  onStatus('Reconciling saved transaction', pending.hash)
  const transaction = await deps.getTransaction(pending.hash)
  assertTransactionMatchesPending(transaction, pending)
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
  assertReadbackMatchesPending(record, pending)
  deps.clear()
  onStatus('Readback confirmed', pending.hash)
  return record
}

export function assertTransactionMatchesPending(transaction: unknown, pending: PendingOperation): void {
  if (!transaction || typeof transaction !== 'object') throw new Error('Transaction lookup returned no verifiable transaction.')
  const value = transaction as Record<string, unknown>
  requireMatchingFields(value, ['hash', 'tx_id', 'txId'], pending.hash, 'transaction hash')
  requireMatchingFields(value, ['from_address', 'origin_address', 'sender'], pending.sender, 'transaction sender')
  requireMatchingFields(value, ['recipient', 'to_address'], pending.contract, 'transaction contract')
  if (value.chainId !== undefined && Number(value.chainId) !== pending.chainId) {
    throw new Error('Transaction chain does not match the saved operation.')
  }
  const data = value.data as { calldata?: { raw?: unknown } } | undefined
  const raw = data?.calldata?.raw
  const expected = Array.from(abi.calldata.encode(abi.calldata.makeCalldataObject(pending.functionName, pending.args, undefined)))
  if (!Array.isArray(raw) || raw.length !== expected.length || raw.some((byte, index) => byte !== expected[index])) {
    throw new Error('Transaction method or arguments do not match the saved operation.')
  }
}

function requireMatchingFields(value: Record<string, unknown>, names: string[], expected: string, label: string): void {
  const fields = names.map((name) => value[name]).filter((item): item is string => typeof item === 'string')
  if (fields.length === 0 || fields.some((item) => item.toLowerCase() !== expected.toLowerCase())) {
    throw new Error(`Returned ${label} does not match the saved operation.`)
  }
}

export function assertReadbackMatchesPending(record: FlightCase, pending: PendingOperation): void {
  if (record.case_id !== pending.caseId) throw new Error('Readback case identity does not match the saved operation.')
  if (pending.functionName === 'register_case') {
    const [caseId, carrier, flightNumber, flightDate, origin, destination, carrierUrl, faaUrl, weatherUrl] = pending.args
    if (pending.args.length !== 9 || record.case_id !== caseId || record.carrier !== carrier
      || record.flight_number !== flightNumber || record.flight_date !== flightDate || record.origin !== origin
      || record.destination !== destination || record.carrier_url !== carrierUrl || record.faa_url !== faaUrl
      || record.weather_url !== weatherUrl || record.submitter.toLowerCase() !== pending.sender.toLowerCase()
      || !['REGISTERED', 'PROVISIONAL_ASSESSED', 'REVISED_ASSESSED'].includes(record.stage)) {
      throw new Error('Registration readback does not match the submitted immutable fields.')
    }
    return
  }
  if (pending.functionName === 'assess_provisional') {
    if (pending.args.length !== 1 || pending.args[0] !== pending.caseId
      || !['PROVISIONAL_ASSESSED', 'REVISED_ASSESSED'].includes(record.stage)
      || record.revision < 1 || record.outcome === '' || record.source_status === '') {
      throw new Error('Provisional assessment readback does not confirm the submitted state effect.')
    }
    return
  }
  if (pending.functionName === 'assess_revision') {
    if (pending.args.length !== 2 || pending.args[0] !== pending.caseId || record.stage !== 'REVISED_ASSESSED'
      || record.revision !== 2 || record.revision_url !== pending.args[1]
      || record.outcome === '' || record.source_status === '') {
      throw new Error('Revision readback does not confirm the submitted state effect.')
    }
    return
  }
  throw new Error('Saved operation contains an unsupported contract method.')
}

export function assertSuccessfulReceipt(receipt: unknown): void {
  if (!receipt || typeof receipt !== 'object') throw new Error('Missing finalized receipt.')
  const value = receipt as {
    statusName?: string
    status_name?: string
    resultName?: string
    result_name?: string
    txExecutionResultName?: string
    consensus_data?: { leader_receipt?: Array<{ mode?: string, execution_result?: string }> }
  }
  const statuses = [value.statusName, value.status_name].filter((item): item is string => item !== undefined)
  if (statuses.length === 0 || statuses.some((status) => status !== 'FINALIZED')) {
    throw new Error('Receipt does not confirm FINALIZED status.')
  }
  const consensus = [value.resultName, value.result_name].filter((item): item is string => item !== undefined)
  const leaderReceipts = value.consensus_data?.leader_receipt
  const executionChecks: boolean[] = []
  if (value.txExecutionResultName !== undefined) executionChecks.push(value.txExecutionResultName === 'FINISHED_WITH_RETURN')
  if (leaderReceipts !== undefined) {
    executionChecks.push(authoritativeLeaderExecution(leaderReceipts) === 'SUCCESS')
  }
  if (consensus.length === 0 || consensus.some((result) => result !== 'MAJORITY_AGREE')
    || executionChecks.length === 0 || executionChecks.some((success) => !success)) {
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
    consensus_data?: { leader_receipt?: Array<{ mode?: string, execution_result?: string }> }
  }
  const statuses = [value.statusName, value.status_name].filter((item): item is string => item !== undefined)
  if (statuses.length === 0 || statuses.some((status) => status !== 'FINALIZED')) return false
  const consensus = [value.resultName, value.result_name].filter((item): item is string => item !== undefined)
  if (consensus.length > 1 && consensus.some((result) => result !== consensus[0])) return false
  const camel = value.txExecutionResultName
  const snake = authoritativeLeaderExecution(value.consensus_data?.leader_receipt)
  if (camel !== undefined && snake !== undefined
    && !((camel === 'FINISHED_WITH_RETURN' && snake === 'SUCCESS')
      || (camel === 'FINISHED_WITH_ERROR' && snake === 'ERROR'))) return false
  if (consensus[0] === 'MAJORITY_DISAGREE' || consensus[0] === 'NO_MAJORITY') return true
  if (consensus.length > 0 && consensus[0] !== 'MAJORITY_AGREE') return false
  if (camel !== undefined && snake !== undefined) {
    return camel === 'FINISHED_WITH_ERROR' && snake === 'ERROR'
  }
  return camel === 'FINISHED_WITH_ERROR' || snake === 'ERROR'
}

function authoritativeLeaderExecution(
  receipts: Array<{ mode?: string, execution_result?: string }> | undefined,
): string | undefined {
  if (!receipts || receipts.length === 0) return undefined
  if (receipts.some((receipt) => receipt.mode !== undefined)) {
    for (let index = receipts.length - 1; index >= 0; index -= 1) {
      if (receipts[index].mode === 'leader') return receipts[index].execution_result
    }
    return undefined
  }
  return receipts.at(-1)?.execution_result
}
