import assert from 'node:assert/strict'
import test from 'node:test'
import { createRequestScope } from '../src/utils/requestScope.js'
import { dateFilterBoundary } from '../src/utils/dateFilters.js'

test('a delayed old response cannot replace a newer filtered result', () => {
  const scope = createRequestScope()
  const oldPage = scope.begin()
  const newFilter = scope.begin()
  let displayed = []
  function complete(request, rows) {
    if (request.isCurrent()) displayed = rows
    request.finish()
  }
  complete(newFilter, ['new-filter-row'])
  complete(oldPage, ['old-page-row'])
  assert.deepEqual(displayed, ['new-filter-row'])
  assert.equal(oldPage.signal.aborted, true)
})

test('finishing a superseded request does not unlock an in-flight new request', () => {
  const scope = createRequestScope()
  const first = scope.begin()
  const second = scope.begin()
  first.finish()
  assert.equal(scope.isPending(), true)
  second.finish()
  assert.equal(scope.isPending(), false)
})

test('unmount cancels requests and suppresses completion; remount can load again', () => {
  const scope = createRequestScope()
  const request = scope.begin()
  scope.dispose()
  assert.equal(request.signal.aborted, true)
  assert.equal(request.isCurrent(), false)
  assert.equal(scope.begin(), null)
  scope.activate()
  assert.equal(scope.begin().isCurrent(), true)
})

test('changing a query invalidates its response before the next fetch starts', () => {
  const scope = createRequestScope()
  const old = scope.begin()
  scope.cancel()
  assert.equal(old.isCurrent(), false)
  assert.equal(scope.isPending(), false)
})

test('date-only range includes late evening on the end day and excludes next day', () => {
  const start = Date.parse(dateFilterBoundary('2026-11-05'))
  const end = Date.parse(dateFilterBoundary('2026-11-05', true))
  const latePayment = new Date(2026, 10, 5, 23, 59, 59, 998).getTime()
  const nextDay = new Date(2026, 10, 6, 0, 0, 0, 0).getTime()
  const previousDay = new Date(2026, 10, 4, 23, 59, 59, 999).getTime()
  assert.ok(latePayment >= start && latePayment <= end)
  assert.ok(nextDay > end)
  assert.ok(previousDay < start)
  assert.match(dateFilterBoundary('2026-11-05', true), /Z$/)
})

test('empty and invalid date inputs cannot silently filter an unintended day', () => {
  assert.equal(dateFilterBoundary(''), undefined)
  assert.throws(() => dateFilterBoundary('2026-02-30'), /Invalid date/)
  assert.throws(() => dateFilterBoundary('11/05/2026'), /Invalid date/)
})
