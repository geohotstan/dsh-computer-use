/**
 * Fake computer-use daemon for `dsh-computer-local` tests: a stateful
 * newline-delimited JSON-RPC 2.0 server whose capture session counts
 * `get_app_state` calls per process (full tree first, marked diff after), so
 * provider tests observe the seam's stateful-diff contract without touching a
 * desktop. Parameter-triggered behaviors: `app: 'slow'` never answers,
 * `app: 'crash'` exits 3, `app: 'malformed'` answers a shape violation,
 * `app: 'noise'` prints a non-JSON line first. SIGTERM marks the exit-marker
 * file named by `FIXTURE_MARKER` before exiting, proving tree termination.
 * `permission_status` echoes `FIXTURE_PERMISSION_STATUS` (a JSON object) when
 * set, otherwise `{ accessibility: true, screenRecording: true, bundled: true }`.
 */

import { writeFileSync } from 'node:fs'
import { createInterface } from 'node:readline'

const marker = process.env.FIXTURE_MARKER
process.on('SIGTERM', () => {
  if (marker !== undefined) writeFileSync(marker, 'terminated')
  process.exit(0)
})

let captures = 0
const respond = (id, result) => {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n')
}
const fail = (id, code, message) => {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }) + '\n')
}

// Keep the process alive after stdin closes (e.g. the sh-wrapper broken-pipe
// scenario); the SIGTERM handler's explicit exit still ends it promptly.
setInterval(() => {}, 60_000)

createInterface({ input: process.stdin }).on('line', (line) => {
  let request
  try {
    request = JSON.parse(line)
  } catch {
    return
  }
  if (request?.jsonrpc !== '2.0' || typeof request.id !== 'number') return
  switch (request.method) {
    case 'list_apps':
      respond(request.id, [
        { id: 'com.apple.TextEdit', displayName: 'TextEdit', isRunning: true, useCount: 3 },
        { id: 'com.apple.Safari', lastUsedDate: '2026-08-14T00:00:00Z' },
      ])
      break
    case 'permission_status': {
      const raw = process.env.FIXTURE_PERMISSION_STATUS
      respond(request.id, raw ? JSON.parse(raw) : { accessibility: true, screenRecording: true, bundled: true })
      break
    }
    case 'request_permissions': {
      const raw = process.env.FIXTURE_PERMISSION_STATUS
      respond(request.id, raw ? JSON.parse(raw) : { accessibility: true, screenRecording: true, bundled: true })
      break
    }
    case 'get_app_state': {
      captures += 1
      const params = request.params ?? {}
      if (params.app === 'slow') break // never answers; the provider's timeout settles it
      if (params.app === 'crash') { process.stderr.write('fake daemon boom\n'); process.exit(3); break }
      if (params.app === 'late') { setTimeout(() => respond(request.id, { app: 'late', text: 'late', screenshot: null }), 500); break }
      if (params.app === 'ignoreline') {
        process.stdout.write('{"jsonrpc":"1.0","id":7}\n')
        respond(request.id, { app: 'ignoreline', text: '0 window', screenshot: null })
        break
      }
      if (params.app === 'errorreply') { fail(request.id, -32000, 'fixture failure'); break }
      if (params.app === 'malformed') { respond(request.id, { app: 42 }); break }
      if (params.app === 'noise') {
        process.stdout.write('not json\n')
        respond(request.id, { app: 'com.apple.TextEdit', text: '0 window', screenshot: null })
        break
      }
      if (params.app === 'big') {
        respond(request.id, { app: 'big', text: `big\n${'x'.repeat(5000)}`, screenshot: null })
        break
      }
      const text = captures === 1
        ? '0 standard window\n\t1 text entry area'
        : 'The following is a diff from the previous accessibility tree\n+ 2 button'
      respond(request.id, {
        app: params.app,
        text,
        screenshot: {
          dataBase64: Buffer.from(`fake-jpeg-${params.app}`).toString('base64'),
          width: 100,
          height: 50,
        },
      })
      break
    }
    case 'press_key':
      respond(request.id, { selectedText: 'fixture-selection' })
      break
    case 'click':
    case 'type_text':
    case 'scroll':
    case 'set_value':
    case 'select_text':
    case 'drag':
    case 'perform_secondary_action':
      respond(request.id, null)
      break
    default:
      fail(request.id, -32601, `unknown method ${request.method}`)
  }
})
