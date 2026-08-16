import { describe, expect, it } from 'vitest'
import { chmodSync, mkdirSync, rmSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { daemonExecutableIn } from '../../src/setup/paths.ts'
import { decodePermissionReply, parseSetupArgs, platformError, runSetupCli } from '../../src/setup/cli.ts'

describe('parseSetupArgs', () => {
  it('defaults to the setup command', () => {
    expect(parseSetupArgs([])).toEqual({ command: 'setup', skipPermissionPrompt: false, installDir: undefined })
  })

  it('recognizes the subcommands and flags', () => {
    expect(parseSetupArgs(['status']).command).toBe('status')
    expect(parseSetupArgs(['-h']).command).toBe('help')
    expect(parseSetupArgs(['--help']).command).toBe('help')
    expect(parseSetupArgs(['--version']).command).toBe('version')
    expect(parseSetupArgs(['--skip-permission-prompt']).skipPermissionPrompt).toBe(true)
    expect(parseSetupArgs(['--install-dir', '/tmp/x']).installDir).toBe('/tmp/x')
    expect(parseSetupArgs(['status', '--install-dir', '/tmp/x'])).toEqual({
      command: 'status',
      skipPermissionPrompt: false,
      installDir: '/tmp/x',
    })
  })

  it('rejects unknown arguments and a valueless --install-dir', () => {
    expect(() => parseSetupArgs(['--wat'])).toThrow(/unknown argument/)
    expect(() => parseSetupArgs(['--install-dir'])).toThrow(/--install-dir needs a directory/)
  })
})

describe('platformError', () => {
  it('names the host platform in the guidance message', () => {
    expect(platformError('linux')).toContain('linux')
    expect(platformError('win32')).toContain('win32')
  })
})

describe('decodePermissionReply', () => {
  it('accepts a well-formed reply for request id 1', () => {
    expect(decodePermissionReply('{"id":1,"result":{"accessibility":true,"screenRecording":false,"bundled":true}}'))
      .toEqual({ accessibility: true, screenRecording: false, bundled: true })
  })

  it('rejects non-JSON, foreign ids, and malformed results', () => {
    expect(() => decodePermissionReply('not json')).toThrow(/non-JSON/)
    expect(() => decodePermissionReply('{"id":2,"result":{}}')).toThrow(/not the expected permission status/)
    expect(() => decodePermissionReply('{"id":1,"result":{"accessibility":"yes","screenRecording":true,"bundled":true}}'))
      .toThrow(/malformed/)
  })
})

describe('runSetupCli', () => {
  it('prints usage for help and exits zero', async () => {
    await expect(runSetupCli(parseSetupArgs(['--help']))).resolves.toBe(0)
  })

  it('refuses setup on non-darwin hosts with actionable guidance', async () => {
    await expect(runSetupCli(parseSetupArgs([]), 'linux')).resolves.toBe(1)
  })

  it('reports a missing install and accepts a present one', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-setup-status-'))
    try {
      await expect(runSetupCli({ command: 'status', skipPermissionPrompt: false, installDir: dir })).resolves.toBe(1)
      const executable = daemonExecutableIn(dir)
      mkdirSync(join(dir, 'dsh-computer-daemon.app', 'Contents', 'MacOS'), { recursive: true })
      writeFileSync(executable, 'stub')
      chmodSync(executable, 0o755)
      await expect(runSetupCli({ command: 'status', skipPermissionPrompt: false, installDir: dir })).resolves.toBe(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
