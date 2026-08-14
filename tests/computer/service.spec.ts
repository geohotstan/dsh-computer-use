import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { ComputerEngine } from '../../src/computer/index.ts'
import type {
  ClickRequest,
  ComputerApp,
  ComputerAppState,
  ComputerExecSpec,
  ComputerPermissionStatus,
  ComputerRecordStatus,
  ComputerRequestBase,
  DragRequest,
  GetAppStateRequest,
  ListAppsRequest,
  PerformSecondaryActionRequest,
  PressKeyRequest,
  ScrollRequest,
  SelectTextRequest,
  SetValueRequest,
  TypeTextRequest,
} from '../../src/computer/index.ts'

/**
 * Minimal concrete engine: a canned app list and state, and recorded input
 * requests. The seam contract is the method set plus resolve defaulting, so
 * this stub is all an implementation owes the abstract class.
 */
class StubEngine extends ComputerEngine {
  calls: string[] = []

  resolve<T extends ComputerRequestBase>(request: T): ComputerExecSpec<T> {
    return {
      request,
      timeoutMs: request.timeoutMs ?? 1_000,
      ...request.signal ? { signal: request.signal } : {},
    }
  }

  async listApps(_spec: ComputerExecSpec<ListAppsRequest>): Promise<ComputerApp[]> {
    this.calls.push('listApps')
    return [{ id: 'com.apple.TextEdit', displayName: 'TextEdit', isRunning: true }]
  }

  async getAppState(_spec: ComputerExecSpec<GetAppStateRequest>): Promise<ComputerAppState> {
    this.calls.push('getAppState')
    return { app: 'com.apple.TextEdit', text: '0 window', truncated: false, screenshot: null }
  }

  async click(_spec: ComputerExecSpec<ClickRequest>): Promise<void> {
    this.calls.push('click')
  }

  async typeText(_spec: ComputerExecSpec<TypeTextRequest>): Promise<void> {
    this.calls.push('typeText')
  }

  async pressKey(_spec: ComputerExecSpec<PressKeyRequest>): Promise<string> {
    this.calls.push('pressKey')
    return ''
  }

  async scroll(_spec: ComputerExecSpec<ScrollRequest>): Promise<void> {
    this.calls.push('scroll')
  }

  async setValue(_spec: ComputerExecSpec<SetValueRequest>): Promise<void> {
    this.calls.push('setValue')
  }

  async selectText(_spec: ComputerExecSpec<SelectTextRequest>): Promise<void> {
    this.calls.push('selectText')
  }

  async drag(_spec: ComputerExecSpec<DragRequest>): Promise<void> {
    this.calls.push('drag')
  }

  async performSecondaryAction(_spec: ComputerExecSpec<PerformSecondaryActionRequest>): Promise<void> {
    this.calls.push('performSecondaryAction')
  }

  async permissionStatus(): Promise<ComputerPermissionStatus> {
    return { accessibility: true, screenRecording: true, bundled: true }
  }

  async requestPermissions(): Promise<ComputerPermissionStatus> {
    return { accessibility: true, screenRecording: true, bundled: true }
  }

  async recordStart(): Promise<ComputerRecordStatus> {
    this.calls.push('recordStart')
    return { recording: false, maxDurationSec: 1800 }
  }

  async recordStatus(): Promise<ComputerRecordStatus> {
    this.calls.push('recordStatus')
    return { recording: false, maxDurationSec: 1800 }
  }

  async recordStop(): Promise<ComputerRecordStatus> {
    this.calls.push('recordStop')
    return { recording: false, maxDurationSec: 1800 }
  }
}

describe('ComputerEngine seam', () => {
  it('registers a concrete engine as ctx.computer', async () => {
    const ctx = new Context()
    await ctx.plugin(StubEngine)
    expect(ctx.computer).toBeInstanceOf(StubEngine)
  })

  it('resolves defaults per implementation and passes the spec to operations', async () => {
    const ctx = new Context()
    await ctx.plugin(StubEngine)
    const engine = ctx.computer as StubEngine
    await engine.listApps(engine.resolve<ListAppsRequest>({}))
    await engine.getAppState(engine.resolve<GetAppStateRequest>({ app: 'TextEdit', timeoutMs: 9_000 }))
    expect(engine.calls).toEqual(['listApps', 'getAppState'])
    expect(engine.resolve<GetAppStateRequest>({ app: 'a' }).timeoutMs).toBe(1_000)
    expect(engine.resolve<GetAppStateRequest>({ app: 'a', timeoutMs: 9_000 }).timeoutMs).toBe(9_000)
  })

  it('covers every operation method through the abstract surface', async () => {
    const ctx = new Context()
    await ctx.plugin(StubEngine)
    const engine = ctx.computer as StubEngine
    await engine.click(engine.resolve<ClickRequest>({ app: 'a', elementIndex: 0 }))
    await engine.typeText(engine.resolve<TypeTextRequest>({ app: 'a', text: 'hi' }))
    await engine.pressKey(engine.resolve<PressKeyRequest>({ app: 'a', key: 'Return' }))
    await engine.scroll(engine.resolve<ScrollRequest>({ app: 'a', elementIndex: 0, direction: 'down' }))
    await engine.setValue(engine.resolve<SetValueRequest>({ app: 'a', elementIndex: 0, value: 'v' }))
    await engine.selectText(engine.resolve<SelectTextRequest>({ app: 'a', elementIndex: 0, text: 't' }))
    await engine.drag(engine.resolve<DragRequest>({ app: 'a', fromX: 0, fromY: 0, toX: 1, toY: 1 }))
    await engine.performSecondaryAction(engine.resolve<PerformSecondaryActionRequest>({ app: 'a', elementIndex: 0, action: 'Raise' }))
    expect(engine.calls).toEqual(['click', 'typeText', 'pressKey', 'scroll', 'setValue', 'selectText', 'drag', 'performSecondaryAction'])
  })
})
