import test from 'node:test'
import assert from 'node:assert/strict'

import {describeReturnTarget, summarizeMonitorMessage,} from '../src/components/noona/rebootMonitorUi.mjs'

test('summarizeMonitorMessage collapses HTML payloads into a friendly fallback', () => {
    assert.equal(
        summarizeMonitorMessage('<!doctype html><html><body>ok</body></html>'),
        'Received an HTML page instead of a dedicated health response.',
    )
})

test('summarizeMonitorMessage trims whitespace and truncates long values', () => {
    const message = summarizeMonitorMessage(`  ${'queue '.repeat(50)}  `, {maxLength: 32})
    assert.equal(message, 'queue queue queue queue queue...')
})

test('describeReturnTarget maps common routes to friendly labels', () => {
    assert.equal(describeReturnTarget('/downloads?view=grid'), 'Downloads')
    assert.equal(describeReturnTarget('/settings/warden'), 'Admin -> System')
    assert.equal(describeReturnTarget('/custom/path'), '/custom/path')
    assert.equal(describeReturnTarget('/'), 'Home')
})
