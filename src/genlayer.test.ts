import { afterEach, describe, expect, it, vi } from 'vitest'
import { abi } from 'genlayer-js'
import {
  assertReadbackMatchesPending,
  assertSuccessfulReceipt,
  assertTransactionMatchesPending,
  loadPendingOperation,
  pendingMatchesContext,
  reconcilePendingOperation,
  savePendingOperation,
  writeAndReadback,
} from './genlayer'
import type { PendingOperation } from './genlayer'
import type { FlightCase } from './types'

const HASH = `0x${'1'.repeat(64)}` as PendingOperation['hash']
const CONTRACT = '0x1111111111111111111111111111111111111111' as const
const SENDER = '0x2222222222222222222222222222222222222222' as const
const REGISTER_ARGS = [
  'CASE-1', 'DL', 'DL105', '2026-08-11', 'ATL', 'LAX',
  'https://www.delta.com/flight-status/search',
  'https://nasstatus.faa.gov/',
  'https://api.weather.gov/alerts/active',
]
const pending: PendingOperation = {
  version: 1,
  hash: HASH,
  chainId: 61999,
  contract: CONTRACT,
  sender: SENDER,
  functionName: 'register_case',
  args: REGISTER_ARGS,
  caseId: 'CASE-1',
}

const registeredCase: FlightCase = {
  case_id: 'CASE-1',
  submitter: SENDER,
  carrier: 'DL',
  flight_number: 'DL105',
  flight_date: '2026-08-11',
  origin: 'ATL',
  destination: 'LAX',
  carrier_url: 'https://www.delta.com/flight-status/search',
  faa_url: 'https://nasstatus.faa.gov/',
  weather_url: 'https://api.weather.gov/alerts/active',
  revision_url: '',
  stage: 'REGISTERED',
  outcome: '',
  explanation: '',
  source_status: '',
  assistance_review_required: false,
  revision: 0,
}

function matchingTransaction(operation: PendingOperation = pending) {
  return {
    hash: operation.hash,
    tx_id: operation.hash,
    from_address: operation.sender,
    origin_address: operation.sender,
    recipient: operation.contract,
    to_address: operation.contract,
    chainId: operation.chainId,
    data: {
      calldata: {
        raw: Array.from(abi.calldata.encode(
          abi.calldata.makeCalldataObject(operation.functionName, operation.args, undefined),
        )),
      },
    },
  }
}

function memoryStorage() {
  const values = new Map<string, string>()
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  }
}

const finalizedSuccess = {
  statusName: 'FINALIZED',
  resultName: 'MAJORITY_AGREE',
  txExecutionResultName: 'FINISHED_WITH_RETURN',
}

const studionetSuccessShape = {
  status_name: 'FINALIZED',
  result_name: 'MAJORITY_AGREE',
  consensus_data: { leader_receipt: [{ execution_result: 'SUCCESS' }] },
}

const capturedFailedDeploymentShape = {
  status_name: 'FINALIZED',
  result_name: 'MAJORITY_AGREE',
  consensus_data: {
    leader_receipt: [
      { execution_result: 'ERROR' },
      { execution_result: 'ERROR' },
    ],
  },
}

afterEach(() => vi.unstubAllGlobals())

describe('finalized receipt validation', () => {
  it.each([
    finalizedSuccess,
    { ...finalizedSuccess, consensus_data: { final: true } },
    studionetSuccessShape,
    {
      status_name: 'FINALIZED', result_name: 'MAJORITY_AGREE',
      consensus_data: { leader_receipt: [{ execution_result: 'ERROR' }, { execution_result: 'SUCCESS' }] },
    },
  ])('accepts explicit SDK and Studionet finalized-success shapes', (receipt) => {
    expect(() => assertSuccessfulReceipt(receipt)).not.toThrow()
  })

  it.each([
    { statusName: 'ACCEPTED', resultName: 'MAJORITY_AGREE', txExecutionResultName: 'FINISHED_WITH_RETURN' },
    { resultName: 'MAJORITY_AGREE', txExecutionResultName: 'FINISHED_WITH_RETURN' },
    { statusName: 'FINALIZED', resultName: 'MAJORITY_DISAGREE', txExecutionResultName: 'FINISHED_WITH_ERROR' },
    { statusName: 'FINALIZED', resultName: 'MAJORITY_AGREE' },
    {
      ...finalizedSuccess,
      consensus_data: { leader_receipt: [{ execution_result: 'ERROR' }, { execution_result: 'SUCCESS' }] },
      txExecutionResultName: 'FINISHED_WITH_ERROR',
    },
    {
      ...finalizedSuccess,
      consensus_data: { leader_receipt: [{ execution_result: 'SUCCESS' }, { execution_result: 'ERROR' }] },
    },
    {
      status_name: 'FINALIZED',
      result_name: 'MAJORITY_AGREE',
      consensus_data: { leader_receipt: [{ execution_result: 'idle' }] },
    },
    {
      statusName: 'FINALIZED', status_name: 'ACCEPTED',
      resultName: 'MAJORITY_AGREE', txExecutionResultName: 'FINISHED_WITH_RETURN',
    },
    {
      statusName: 'FINALIZED', resultName: 'MAJORITY_AGREE', result_name: 'MAJORITY_DISAGREE',
      txExecutionResultName: 'FINISHED_WITH_RETURN',
    },
    capturedFailedDeploymentShape,
    {},
    null,
  ])('fails closed for accepted, missing, failed, or incomplete receipts', (receipt) => {
    expect(() => assertSuccessfulReceipt(receipt)).toThrow()
  })
})

describe('pending transaction recovery', () => {
  it('persists the complete operation across a refresh boundary', () => {
    const storage = memoryStorage()
    savePendingOperation(pending, storage)
    expect(loadPendingOperation(storage)).toEqual(pending)
  })

  it('rejects sender or contract mismatches without changing the pending operation', () => {
    expect(pendingMatchesContext(pending, SENDER, CONTRACT)).toBe(true)
    expect(pendingMatchesContext(pending, '0x3333333333333333333333333333333333333333', CONTRACT)).toBe(false)
    expect(pendingMatchesContext(pending, SENDER, '0x4444444444444444444444444444444444444444')).toBe(false)
  })

  it.each([
    ['hash', { hash: `0x${'9'.repeat(64)}` }],
    ['sender', { from_address: '0x3333333333333333333333333333333333333333' }],
    ['contract', { recipient: '0x4444444444444444444444444444444444444444' }],
    ['chain', { chainId: 1 }],
    ['method', { data: { calldata: { raw: Array.from(abi.calldata.encode(abi.calldata.makeCalldataObject('assess_provisional', ['CASE-1'], undefined))) } } }],
    ['arguments', { data: { calldata: { raw: Array.from(abi.calldata.encode(abi.calldata.makeCalldataObject('register_case', [...REGISTER_ARGS.slice(0, 8), 'https://www.weather.gov/'], undefined))) } } }],
  ])('rejects a transaction with a mismatched %s', (_label, mutation) => {
    expect(() => assertTransactionMatchesPending({ ...matchingTransaction(), ...mutation }, pending)).toThrow(/do(?:es)? not match/)
  })

  it('rejects manual reconciliation outside the saved sender context before reading the hash', async () => {
    let lookedUp = false
    let cleared = false
    await expect(reconcilePendingOperation(
      pending,
      '0x3333333333333333333333333333333333333333',
      () => undefined,
      {
        getTransaction: async () => { lookedUp = true; return matchingTransaction() },
        waitForFinalized: async () => finalizedSuccess,
        readCase: async () => registeredCase,
        clear: () => { cleared = true },
      },
      CONTRACT,
    )).rejects.toThrow('active sender')
    expect(lookedUp).toBe(false)
    expect(cleared).toBe(false)
  })

  it('reconciles finalized success, performs readback, and only then clears', async () => {
    const events: string[] = []
    let cleared = false
    await expect(reconcilePendingOperation(pending, SENDER, (status) => events.push(status), {
      getTransaction: async () => matchingTransaction(),
      waitForFinalized: async () => finalizedSuccess,
      readCase: async () => registeredCase,
      clear: () => { cleared = true },
    }, CONTRACT)).resolves.toBe(registeredCase)
    expect(cleared).toBe(true)
    expect(events.at(-1)).toBe('Readback confirmed')
  })

  it('retains the pending operation when finalized readback is delayed', async () => {
    let cleared = false
    await expect(reconcilePendingOperation(pending, SENDER, () => undefined, {
      getTransaction: async () => matchingTransaction(),
      waitForFinalized: async () => finalizedSuccess,
      readCase: async () => null,
      clear: () => { cleared = true },
    }, CONTRACT)).rejects.toThrow('reconciliation remains pending')
    expect(cleared).toBe(false)
  })

  it('clears a proven finalized execution failure so a deliberate retry can occur', async () => {
    let cleared = false
    await expect(reconcilePendingOperation(pending, SENDER, () => undefined, {
      getTransaction: async () => matchingTransaction(),
      waitForFinalized: async () => ({
        ...capturedFailedDeploymentShape,
      }),
      readCase: async () => null,
      clear: () => { cleared = true },
    }, CONTRACT)).rejects.toThrow('successful leader execution')
    expect(cleared).toBe(true)
  })

  it('retains pending state for an all-idle execution envelope', async () => {
    let cleared = false
    await expect(reconcilePendingOperation(pending, SENDER, () => undefined, {
      getTransaction: async () => matchingTransaction(),
      waitForFinalized: async () => ({
        status_name: 'FINALIZED',
        result_name: 'MAJORITY_AGREE',
        consensus_data: { leader_receipt: [{ execution_result: 'idle' }] },
      }),
      readCase: async () => registeredCase,
      clear: () => { cleared = true },
    }, CONTRACT)).rejects.toThrow('successful leader execution')
    expect(cleared).toBe(false)
  })

  it.each([
    ['stale case', { ...registeredCase, carrier: 'AA' }],
    ['wrong stage', { ...registeredCase, stage: 'REGISTERED' }, { ...pending, functionName: 'assess_provisional', args: ['CASE-1'] }],
    ['wrong revision URL', { ...registeredCase, stage: 'REVISED_ASSESSED', revision: 2, outcome: 'NAS_CORROBORATED', source_status: 'FAA available', revision_url: 'https://www.aspm.faa.gov/wrong' }, { ...pending, functionName: 'assess_revision', args: ['CASE-1', 'https://www.aspm.faa.gov/expected'] }],
  ])('rejects %s readback without clearing the pending identity', (_label, record, operation = pending) => {
    expect(() => assertReadbackMatchesPending(record as FlightCase, operation as PendingOperation)).toThrow('does not')
  })

  it('prevents a replay while a saved operation remains unresolved', async () => {
    const storage = memoryStorage()
    savePendingOperation(pending, storage)
    vi.stubGlobal('window', { localStorage: storage })
    await expect(writeAndReadback(
      { request: async () => undefined },
      SENDER,
      'register_case',
      ['CASE-1'],
      'CASE-1',
      () => undefined,
    )).rejects.toThrow('must be reconciled')
    expect(loadPendingOperation(storage)).toEqual(pending)
  })
})
