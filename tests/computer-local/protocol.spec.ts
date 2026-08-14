/**
 * Wire-boundary decoder and protocol tests: the exact validation rules the
 * engine applies to daemon payloads, exercised directly so every violation
 * path has a pinned case. No daemon process runs here.
 */

import { describe, expect, it } from 'vitest'
import {
  DENIED_APPS_ENV,
  FOREGROUND_APPS_ENV,
  URL_ALLOW_ENV,
  URL_DENY_ENV,
  csvEnv,
  decodeAppState,
  decodeRecordStatus,
  decodeApps,
  decodePermissionStatus,
  foregroundAppsEnv,
  HELPER_PATH_ENV,
  LineDecoder,
  buildRequest,
  parseResponse,
} from '../../src/computer-local/index.ts'

describe('decodeApps', () => {
  it('decodes a complete app entry', () => {
    expect(decodeApps([{
      id: 'com.apple.TextEdit',
      displayName: 'TextEdit',
      isRunning: true,
      lastUsedDate: '2026-08-14T00:00:00Z',
      useCount: 3,
    }])).toEqual([{
      id: 'com.apple.TextEdit',
      displayName: 'TextEdit',
      isRunning: true,
      lastUsedDate: '2026-08-14T00:00:00Z',
      useCount: 3,
    }])
  })

  it('rejects a non-array result and entries without a string id', () => {
    expect(() => decodeApps(null)).toThrow(/non-array app list/)
    expect(() => decodeApps([{ displayName: 'x' }])).toThrow(/lacks a string id/)
  })

  it('rejects wrongly typed optional fields', () => {
    expect(() => decodeApps([{ id: 'a', displayName: 1 }])).toThrow(/non-string displayName/)
    expect(() => decodeApps([{ id: 'a', lastUsedDate: 1 }])).toThrow(/non-string lastUsedDate/)
    expect(() => decodeApps([{ id: 'a', isRunning: 'yes' }])).toThrow(/non-boolean isRunning/)
    expect(() => decodeApps([{ id: 'a', useCount: 1.5 }])).toThrow(/non-integer useCount/)
    expect(() => decodeApps([{ id: 'a', useCount: -1 }])).toThrow(/non-integer useCount/)
  })
})

describe('decodeRecordStatus', () => {
  it('decodes a live and a finished status, rejecting malformed payloads', () => {
    expect(decodeRecordStatus({ recording: true, maxDurationSec: 1800, elapsedSec: 2.5, eventCount: 7, startTime: 1 }))
      .toEqual({ recording: true, maxDurationSec: 1800, elapsedSec: 2.5, eventCount: 7, startTime: 1 })
    expect(decodeRecordStatus({ recording: false, maxDurationSec: 1800, path: '/tmp/rec.json' }))
      .toEqual({ recording: false, maxDurationSec: 1800, path: '/tmp/rec.json' })
    expect(() => decodeRecordStatus({ recording: 'yes', maxDurationSec: 1800 })).toThrow(/malformed record status/)
    expect(() => decodeRecordStatus({ recording: false })).toThrow(/malformed record status/)
  })
})

describe('decodeAppState', () => {
  it('decodes a state with a null screenshot', () => {
    expect(decodeAppState({ app: 'a', text: 'tree', screenshot: null }, 100)).toEqual({
      app: 'a', text: 'tree', screenshot: null,
    })
  })

  it('decodes the screenshot payload within the bound', () => {
    const result = decodeAppState({
      app: 'a',
      text: 'tree',
      screenshot: { dataBase64: Buffer.from('jpeg').toString('base64'), width: 100, height: 50 },
    }, 100)
    expect(result.screenshot).toEqual({ data: Buffer.from('jpeg'), mediaType: 'image/jpeg', width: 100, height: 50 })
  })

  it('rejects malformed states and screenshots', () => {
    expect(() => decodeAppState({ app: 42 }, 100)).toThrow(/malformed app state/)
    expect(() => decodeAppState({ app: 'a', text: 't', screenshot: {} }, 100)).toThrow(/malformed screenshot/)
    expect(() => decodeAppState({ app: 'a', text: 't', screenshot: { dataBase64: 'x', width: 0, height: 1 } }, 100))
      .toThrow(/positive integers/)
    expect(() => decodeAppState({ app: 'a', text: 't', screenshot: { dataBase64: '!!!', width: 1, height: 1 } }, 100))
      .toThrow(/zero bytes/)
    expect(() => decodeAppState({ app: 'a', text: 't', screenshot: { dataBase64: 'YWJjZA==', width: 1, height: 1 } }, 2))
      .toThrow(/exceeds the 2-byte bound/)
  })
})

describe('decodePermissionStatus', () => {
  it('decodes the grant state and rejects malformed payloads', () => {
    expect(decodePermissionStatus({ accessibility: true, screenRecording: false, bundled: true }))
      .toEqual({ accessibility: true, screenRecording: false, bundled: true })
    expect(() => decodePermissionStatus(null)).toThrow(/malformed permission status/)
    expect(() => decodePermissionStatus({ accessibility: true })).toThrow(/malformed permission status/)
    expect(() => decodePermissionStatus({ accessibility: 'yes', screenRecording: true, bundled: true }))
      .toThrow(/malformed permission status/)
    expect(() => decodePermissionStatus({ accessibility: true, screenRecording: 1, bundled: true }))
      .toThrow(/malformed permission status/)
    expect(() => decodePermissionStatus({ accessibility: true, screenRecording: true, bundled: 'yes' }))
      .toThrow(/malformed permission status/)
  })
})

describe('protocol helpers', () => {
  it('builds a JSON-RPC request line', () => {
    const line = buildRequest(7, 'list_apps', { order: 'usage' })
    expect(JSON.parse(line)).toEqual({ jsonrpc: '2.0', id: 7, method: 'list_apps', params: { order: 'usage' } })
  })

  it('builds deployment-policy environment entries', () => {
    expect(foregroundAppsEnv(['com.a.Brave', ' com.b.App '])).toEqual({ [FOREGROUND_APPS_ENV]: 'com.a.Brave,com.b.App' })
    expect(foregroundAppsEnv([])).toBeUndefined()
    expect(csvEnv(URL_ALLOW_ENV, ['https://x.com', ' https://docs.google.com ']))
      .toEqual({ [URL_ALLOW_ENV]: 'https://x.com,https://docs.google.com' })
    expect(csvEnv(URL_DENY_ENV, [])).toBeUndefined()
    expect(csvEnv(DENIED_APPS_ENV, ['com.example.Blocked'])).toEqual({ [DENIED_APPS_ENV]: 'com.example.Blocked' })
    expect(csvEnv(URL_ALLOW_ENV, ['  ', ''])).toBeUndefined()
  })

  it('parses result and error responses, dropping malformed lines', () => {
    expect(parseResponse({ jsonrpc: '2.0', id: 1, result: null })).toEqual({ jsonrpc: '2.0', id: 1, result: null })
    expect(parseResponse({ jsonrpc: '2.0', id: 1, error: { code: -32000, message: 'no' } }))
      .toEqual({ jsonrpc: '2.0', id: 1, error: { code: -32000, message: 'no' } })
    expect(parseResponse(null)).toBeNull()
    expect(parseResponse({ jsonrpc: '1.0', id: 1 })).toBeNull()
    expect(parseResponse({ jsonrpc: '2.0', id: 'x' })).toBeNull()
    expect(parseResponse({ jsonrpc: '2.0', id: 1, error: 'broken' })).toBeNull()
    expect(parseResponse({ jsonrpc: '2.0', id: 1, error: { message: 'no' } })).toBeNull()
  })

  it('decodes streamed lines and drains the final unterminated tail', () => {
    const decoder = new LineDecoder()
    expect(decoder.push(Buffer.from('{"a":1}\n{"b":'))).toEqual(['{"a":1}'])
    expect(decoder.push(Buffer.from('2}\n'))).toEqual(['{"b":2}'])
    expect(decoder.end()).toEqual([])
    decoder.push(Buffer.from('tail'))
    expect(decoder.end()).toEqual(['tail'])
    expect(decoder.end()).toEqual([])
  })
})

describe('HELPER_PATH_ENV', () => {
  it('names the environment override the engine reads', () => {
    expect(HELPER_PATH_ENV).toBe('DSH_COMPUTER_HELPER_PATH')
  })
})

describe('foregroundAppsEnv', () => {
  it('names the daemon-facing variable and encodes the pinned app list', () => {
    expect(FOREGROUND_APPS_ENV).toBe('DSH_COMPUTER_FOREGROUND_APPS')
    expect(foregroundAppsEnv(['com.a.Brave', ' com.b.App '])).toEqual({
      DSH_COMPUTER_FOREGROUND_APPS: 'com.a.Brave,com.b.App',
    })
    expect(foregroundAppsEnv(['  '])).toBeUndefined()
    expect(foregroundAppsEnv([])).toBeUndefined()
  })
})
