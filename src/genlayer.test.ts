import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  assertSuccessfulReceipt,
  loadPendingOperation,
  pendingMatchesContext,
  reconcilePendingOperation,
  savePendingOperation,
  writeAndReadback,
} from './genlayer'
import type { PendingOperation } from './genlayer'

const HASH = `0x${'1'.repeat(64)}` as PendingOperation['hash']
const CONTRACT = '0x1111111111111111111111111111111111111111' as const
const SENDER = '0x2222222222222222222222222222222222222222' as const
const pending: PendingOperation = {
  version: 1,
  hash: HASH,
  chainId: 61999,
  contract: CONTRACT,
  sender: SENDER,
  functionName: 'register_case',
  args: ['CASE-1'],
  caseId: 'CASE-1',
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
  ])('accepts explicit SDK and Studionet finalized-success shapes', (receipt) => {
    expect(() => assertSuccessfulReceipt(receipt)).not.toThrow()
  })

  it.each([
    { statusName: 'ACCEPTED', resultName: 'MAJORITY_AGREE', txExecutionResultName: 'FINISHED_WITH_RETURN' },
    { resultName: 'MAJORITY_AGREE', txExecutionResultName: 'FINISHED_WITH_RETURN' },
    { statusName: 'FINALIZED', resultName: 'MAJORITY_DISAGREE', txExecutionResultName: 'FINISHED_WITH_ERROR' },
    { statusName: 'FINALIZED', resultName: 'MAJORITY_AGREE' },
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

  it('reconciles finalized success, performs readback, and only then clears', async () => {
    const events: string[] = []
    let cleared = false
    const record = { case_id: 'CASE-1' } as never
    await expect(reconcilePendingOperation(pending, (status) => events.push(status), {
      getTransaction: async () => ({ statusName: 'FINALIZED' }),
      waitForFinalized: async () => finalizedSuccess,
      readCase: async () => record,
      clear: () => { cleared = true },
    })).resolves.toBe(record)
    expect(cleared).toBe(true)
    expect(events.at(-1)).toBe('Readback confirmed')
  })

  it('retains the pending operation when finalized readback is delayed', async () => {
    let cleared = false
    await expect(reconcilePendingOperation(pending, () => undefined, {
      getTransaction: async () => ({ statusName: 'FINALIZED' }),
      waitForFinalized: async () => finalizedSuccess,
      readCase: async () => null,
      clear: () => { cleared = true },
    })).rejects.toThrow('reconciliation remains pending')
    expect(cleared).toBe(false)
  })

  it('clears a proven finalized execution failure so a deliberate retry can occur', async () => {
    let cleared = false
    await expect(reconcilePendingOperation(pending, () => undefined, {
      getTransaction: async () => ({ statusName: 'FINALIZED' }),
      waitForFinalized: async () => ({
        ...capturedFailedDeploymentShape,
      }),
      readCase: async () => null,
      clear: () => { cleared = true },
    })).rejects.toThrow('successful leader execution')
    expect(cleared).toBe(true)
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
