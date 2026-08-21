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
  validateDisruptionWindow,
  writeAndReadback,
} from './genlayer'
import type { PendingOperation } from './genlayer'
import type { FlightCase } from './types'

const HASH = `0x${'1'.repeat(64)}` as PendingOperation['hash']
const CONTRACT = '0x1111111111111111111111111111111111111111' as const
const SENDER = '0x2222222222222222222222222222222222222222' as const
const REGISTER_ARGS = [
  'CASE-1', 'DL', 'DL105', '2026-08-11', 'ATL', 'LAX',
  '2026-08-11T14:00Z', '2026-08-11T18:00Z',
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
  window_start_utc: '2026-08-11T14:00Z',
  window_end_utc: '2026-08-11T18:00Z',
  carrier_url: 'https://www.delta.com/flight-status/search',
  faa_url: 'https://nasstatus.faa.gov/',
  weather_url: 'https://api.weather.gov/alerts/active',
  revision_url: '',
  stage: 'REGISTERED',
  outcome: '',
  explanation: '',
  source_status: '',
  source_bindings: {},
  evidence_digests: {},
  grounded_excerpts: {},
  assistance_review_required: false,
  revision: 0,
}

const assessedCaseWithEvidence: FlightCase = {
  ...registeredCase,
  stage: 'PROVISIONAL_ASSESSED',
  outcome: 'WEATHER_CORROBORATED',
  explanation: 'Independent weather evidence corroborates disruption window.',
  source_status: 'weather bound; carrier unbound; faa unbound',
  source_bindings: {
    carrier: 'UNBOUND',
    faa: 'UNBOUND',
    weather: 'BOUND',
  },
  evidence_digests: {
    carrier: 'a'.repeat(64),
    faa: 'b'.repeat(64),
    weather: 'c'.repeat(64),
  },
  grounded_excerpts: {
    carrier: '',
    faa: '',
    weather: 'Severe Thunderstorm Warning ATL 14:30Z-17:30Z',
  },
  revision: 1,
}

const revisedCaseWithEvidence: FlightCase = {
  ...assessedCaseWithEvidence,
  stage: 'REVISED_ASSESSED',
  revision: 2,
  revision_url: 'https://www.transtats.bts.gov/homepage.asp',
  source_bindings: { ...assessedCaseWithEvidence.source_bindings, revision: 'BOUND' },
  evidence_digests: { ...assessedCaseWithEvidence.evidence_digests, revision: 'd'.repeat(64) },
  grounded_excerpts: { ...assessedCaseWithEvidence.grounded_excerpts, revision: 'DL105 revision evidence' },
}

const historicalCaseWithoutEvidence: FlightCase = {
  case_id: 'HISTORICAL-1',
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
  stage: 'PROVISIONAL_ASSESSED',
  outcome: 'WEATHER_CORROBORATED',
  explanation: 'Old assessment without cryptographic identity',
  source_status: 'legacy assessment',
  assistance_review_required: false,
  revision: 1,
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

describe('disruption window validation', () => {
  it('accepts valid UTC window matching flight date with start before end', () => {
    expect(validateDisruptionWindow('2026-08-11T14:00Z', '2026-08-11T18:00Z', '2026-08-11')).toBeNull()
  })

  it.each([
    ['missing start', '', '2026-08-11T18:00Z', '2026-08-11', /required/],
    ['missing end', '2026-08-11T14:00Z', '', '2026-08-11', /required/],
    ['no T separator', '2026-08-11 14:00Z', '2026-08-11T18:00Z', '2026-08-11', /exact UTC format/],
    ['no Z suffix', '2026-08-11T14:00', '2026-08-11T18:00Z', '2026-08-11', /exact UTC format/],
    ['includes seconds', '2026-08-11T14:00:00Z', '2026-08-11T18:00:00Z', '2026-08-11', /exact UTC format/],
    ['wrong flight date on start', '2026-08-12T14:00Z', '2026-08-11T18:00Z', '2026-08-11', /registered flight date/],
    ['wrong flight date on end', '2026-08-11T14:00Z', '2026-08-12T18:00Z', '2026-08-11', /registered flight date/],
    ['zero length window', '2026-08-11T14:00Z', '2026-08-11T14:00Z', '2026-08-11', /strictly before/],
    ['reversed window', '2026-08-11T18:00Z', '2026-08-11T14:00Z', '2026-08-11', /strictly before/],
    ['invalid hour', '2026-08-11T25:00Z', '2026-08-11T26:00Z', '2026-08-11', /invalid time/],
    ['invalid minute', '2026-08-11T14:60Z', '2026-08-11T18:00Z', '2026-08-11', /invalid time/],
  ])('rejects %s before write', (_label, start, end, date, pattern) => {
    expect(validateDisruptionWindow(start, end, date)).toMatch(pattern)
  })
})

describe('calldata and readback window binding', () => {
  it('encodes all 11 registration arguments in exact order', () => {
    const obj = abi.calldata.makeCalldataObject('register_case', REGISTER_ARGS, undefined) as { method: string; args: string[] }
    expect(obj.method).toBe('register_case')
    expect(obj.args).toEqual(REGISTER_ARGS)
    expect(obj.args[6]).toBe('2026-08-11T14:00Z')
    expect(obj.args[7]).toBe('2026-08-11T18:00Z')
  })

  it('verifies registration readback matches exact window arguments', () => {
    expect(() => assertReadbackMatchesPending(registeredCase, pending)).not.toThrow()
  })

  it.each([
    ['mismatched window_start_utc', { ...registeredCase, window_start_utc: '2026-08-11T15:00Z' }],
    ['mismatched window_end_utc', { ...registeredCase, window_end_utc: '2026-08-11T19:00Z' }],
    ['missing window_start_utc', { ...registeredCase, window_start_utc: undefined }],
    ['missing window_end_utc', { ...registeredCase, window_end_utc: undefined }],
  ])('rejects registration readback with %s', (_label, mutated) => {
    expect(() => assertReadbackMatchesPending(mutated as FlightCase, pending)).toThrow(/immutable fields/)
  })

  it('accepts provisional assessment readback containing bound evidence and digests', () => {
    const provPending: PendingOperation = {
      ...pending,
      functionName: 'assess_provisional',
      args: ['CASE-1'],
    }
    expect(() => assertReadbackMatchesPending(assessedCaseWithEvidence, provPending)).not.toThrow()
    expect(assessedCaseWithEvidence.source_bindings?.weather).toBe('BOUND')
    expect(assessedCaseWithEvidence.evidence_digests?.weather).toHaveLength(64)
    expect(assessedCaseWithEvidence.grounded_excerpts?.weather).toContain('Severe Thunderstorm')
  })

  const assessmentMethods = [
    {
      label: 'provisional',
      record: assessedCaseWithEvidence,
      operation: { ...pending, functionName: 'assess_provisional', args: ['CASE-1'] } as PendingOperation,
      categories: ['carrier', 'faa', 'weather'],
    },
    {
      label: 'revision',
      record: revisedCaseWithEvidence,
      operation: { ...pending, functionName: 'assess_revision', args: ['CASE-1', revisedCaseWithEvidence.revision_url] } as PendingOperation,
      categories: ['carrier', 'faa', 'weather', 'revision'],
    },
  ]

  it.each(assessmentMethods)('accepts valid $label provenance', ({ record, operation }) => {
    expect(() => assertReadbackMatchesPending(record, operation)).not.toThrow()
  })

  it.each(assessmentMethods)('rejects malformed, missing, and extra $label provenance', ({ record, operation, categories }) => {
    const category = categories[0]
    const mutations: FlightCase[] = [
      { ...record, source_bindings: { ...record.source_bindings, [category]: 'bound' } as FlightCase['source_bindings'] },
      { ...record, evidence_digests: { ...record.evidence_digests, [category]: 'A'.repeat(64) } },
      { ...record, grounded_excerpts: { ...record.grounded_excerpts, [category]: 7 as unknown as string } },
      { ...record, source_bindings: Object.fromEntries(Object.entries(record.source_bindings ?? {}).filter(([key]) => key !== category)) },
      { ...record, evidence_digests: Object.fromEntries(Object.entries(record.evidence_digests ?? {}).filter(([key]) => key !== category)) },
      { ...record, grounded_excerpts: Object.fromEntries(Object.entries(record.grounded_excerpts ?? {}).filter(([key]) => key !== category)) },
      { ...record, source_bindings: { ...record.source_bindings, extra: 'UNBOUND' } },
      { ...record, evidence_digests: { ...record.evidence_digests, extra: 'e'.repeat(64) } },
      { ...record, grounded_excerpts: { ...record.grounded_excerpts, extra: '' } },
      { ...record, source_bindings: { ...record.source_bindings, [category]: 'BOUND' }, grounded_excerpts: { ...record.grounded_excerpts, [category]: '' } },
      { ...record, source_bindings: { ...record.source_bindings, [category]: 'BOUND' }, grounded_excerpts: { ...record.grounded_excerpts, [category]: 'x'.repeat(601) } },
      { ...record, source_bindings: { ...record.source_bindings, [category]: 'UNAVAILABLE' }, grounded_excerpts: { ...record.grounded_excerpts, [category]: 'must be empty' } },
    ]
    for (const mutation of mutations) {
      expect(() => assertReadbackMatchesPending(mutation, operation)).toThrow(/provenance/)
    }
  })

  it('allows reading historical cases without error', () => {
    expect(historicalCaseWithoutEvidence.case_id).toBe('HISTORICAL-1')
    expect(historicalCaseWithoutEvidence.evidence_digests).toBeUndefined()
  })
})

describe('finalized receipt validation', () => {
  it.each([
    finalizedSuccess,
    { ...finalizedSuccess, consensus_data: { final: true } },
    studionetSuccessShape,
    {
      status_name: 'FINALIZED', result_name: 'MAJORITY_AGREE',
      consensus_data: { leader_receipt: [{ execution_result: 'ERROR' }, { execution_result: 'SUCCESS' }] },
    },
    {
      status_name: 'FINALIZED', result_name: 'MAJORITY_AGREE',
      consensus_data: { leader_receipt: [
        { mode: 'leader', execution_result: 'SUCCESS' },
        { mode: 'validator', execution_result: 'ERROR' },
      ] },
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
    ['arguments', { data: { calldata: { raw: Array.from(abi.calldata.encode(abi.calldata.makeCalldataObject('register_case', [...REGISTER_ARGS.slice(0, 10), 'https://www.weather.gov/'], undefined))) } } }],
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

  it.each([
    ['execution error', capturedFailedDeploymentShape],
    ['majority disagree', {
      statusName: 'FINALIZED', status_name: 'FINALIZED',
      resultName: 'MAJORITY_DISAGREE', result_name: 'MAJORITY_DISAGREE',
    }],
    ['no majority', {
      statusName: 'FINALIZED', status_name: 'FINALIZED',
      resultName: 'NO_MAJORITY', result_name: 'NO_MAJORITY',
    }],
  ])('clears a proven finalized %s so a deliberate retry can occur', async (_label, receipt) => {
    let cleared = false
    await expect(reconcilePendingOperation(pending, SENDER, () => undefined, {
      getTransaction: async () => matchingTransaction(),
      waitForFinalized: async () => receipt,
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
    ['camel agree, snake disagree', 'MAJORITY_AGREE', 'MAJORITY_DISAGREE'],
    ['camel disagree, snake agree', 'MAJORITY_DISAGREE', 'MAJORITY_AGREE'],
  ])('retains and blocks replay for conflicting consensus: %s', async (_label, resultName, result_name) => {
    const storage = memoryStorage()
    savePendingOperation(pending, storage)
    vi.stubGlobal('window', { localStorage: storage })
    let cleared = false
    await expect(reconcilePendingOperation(pending, SENDER, () => undefined, {
      getTransaction: async () => matchingTransaction(),
      waitForFinalized: async () => ({
        statusName: 'FINALIZED', status_name: 'FINALIZED', resultName, result_name,
        txExecutionResultName: 'FINISHED_WITH_ERROR',
        consensus_data: { leader_receipt: [{ execution_result: 'ERROR' }] },
      }),
      readCase: async () => registeredCase,
      clear: () => { cleared = true },
    }, CONTRACT)).rejects.toThrow('successful leader execution')
    expect(cleared).toBe(false)
    expect(loadPendingOperation(storage)).toEqual(pending)
    await expect(writeAndReadback(
      { request: async () => undefined }, SENDER, 'register_case', ['CASE-1'], 'CASE-1', () => undefined,
    )).rejects.toThrow('must be reconciled')
  })

  it('retains pending state when execution authorities conflict during consensus failure', async () => {
    let cleared = false
    await expect(reconcilePendingOperation(pending, SENDER, () => undefined, {
      getTransaction: async () => matchingTransaction(),
      waitForFinalized: async () => ({
        statusName: 'FINALIZED', resultName: 'MAJORITY_DISAGREE',
        txExecutionResultName: 'FINISHED_WITH_RETURN',
        consensus_data: { leader_receipt: [{ execution_result: 'ERROR' }] },
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
