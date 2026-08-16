import { describe, expect, it } from 'vitest'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { daemonExecutableIn, defaultHelperPath, expandTilde, resolveInstallDir } from '../../src/setup/paths.ts'

describe('expandTilde', () => {
  it('expands bare and prefixed tildes against the OS home', () => {
    expect(expandTilde('~')).toBe(homedir())
    expect(expandTilde('~/computer-use')).toBe(join(homedir(), 'computer-use'))
    expect(expandTilde('/absolute/path')).toBe('/absolute/path')
    expect(expandTilde('relative/path')).toBe('relative/path')
  })
})

describe('resolveInstallDir', () => {
  it('defaults to ~/.dsh/computer-use', () => {
    expect(resolveInstallDir({})).toBe(join(homedir(), '.dsh', 'computer-use'))
  })

  it('honors DSH_HOME, tilde-expanded', () => {
    expect(resolveInstallDir({ DSH_HOME: '/custom/home' })).toBe(join('/custom/home', 'computer-use'))
    expect(resolveInstallDir({ DSH_HOME: '~/.elsewhere' })).toBe(join(homedir(), '.elsewhere', 'computer-use'))
  })

  it('ignores an empty DSH_HOME', () => {
    expect(resolveInstallDir({ DSH_HOME: '' })).toBe(join(homedir(), '.dsh', 'computer-use'))
  })
})

describe('daemonExecutableIn', () => {
  it('names the executable inside the signed .app bundle', () => {
    expect(daemonExecutableIn('/base')).toBe(
      join('/base', 'dsh-computer-daemon.app', 'Contents', 'MacOS', 'dsh-computer-daemon'),
    )
  })
})

describe('defaultHelperPath', () => {
  it('is the executable in the DSH-home install directory', () => {
    expect(defaultHelperPath()).toBe(daemonExecutableIn(resolveInstallDir()))
  })
})
