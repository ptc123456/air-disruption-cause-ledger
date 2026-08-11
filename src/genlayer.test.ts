import { describe, expect, it } from 'vitest'
import { assertSuccessfulReceipt } from './genlayer'

describe('finalized receipt validation', () => {
  it('accepts finalized successful execution', () => {
    expect(() => assertSuccessfulReceipt({
      statusName: 'FINALIZED',
      resultName: 'SUCCESS',
      txExecutionResultName: 'FINISHED_WITH_RETURN',
    })).not.toThrow()
  })

  it.each([
    [{ statusName: 'ACCEPTED', resultName: 'SUCCESS', txExecutionResultName: 'FINISHED_WITH_RETURN' }],
    [{ statusName: 'FINALIZED', resultName: 'FAILURE', txExecutionResultName: 'FINISHED_WITH_ERROR' }],
    [null],
  ])('fails closed for incomplete or failed receipts', (receipt) => {
    expect(() => assertSuccessfulReceipt(receipt)).toThrow()
  })
})
