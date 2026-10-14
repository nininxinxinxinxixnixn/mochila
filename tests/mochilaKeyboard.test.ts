import { beforeEach, describe, expect, it, vi } from 'vitest'
const native = vi.hoisted(() => ({ callback: null as null | ((code: number, message: number, data: unknown) => number), foreground: '100', modifiers: new Set<number>([0x11]), sent: 0, failInstall: false }))
vi.mock('koffi', () => ({ default: {
  load: () => ({ func: (signature: string) => {
    if (signature.includes('SetWindowsHookExW')) return () => native.failInstall ? null : 99
    if (signature.includes('CallNextHookEx')) return () => 0
    if (signature.includes('UnhookWindowsHookEx')) return () => 1
    if (signature.includes('GetForegroundWindow')) return () => native.foreground
    if (signature.includes('GetAsyncKeyState')) return (key: number) => native.modifiers.has(key) ? 0x8000 : 0
    if (signature.includes('SendInput')) return (count: number) => { native.sent += count; return count }
    throw new Error('unexpected binding')
  } }), proto: () => 'proc', struct: () => 'data', pointer: () => 'pointer', decode: (data: unknown) => data,
  register: (callback: typeof native.callback) => { native.callback = callback; return 1 }, unregister: () => { native.callback = null }
} }))
import { WindowsPaste } from '../electron/mochila/WindowsPaste'
const tick = () => new Promise<void>(done => setImmediate(done))
beforeEach(() => { native.callback = null; native.foreground = '100'; native.modifiers = new Set([0x11]); native.sent = 0; native.failInstall = false })
describe('Ctrl+V boundary with mocked Win32 only', () => {
  it('delivers once per released physical gesture and never while V is held', async () => { const p = new WindowsPaste(); const next = vi.fn(); p.arm(next, () => {}, () => false); const callback = native.callback!; expect(callback(0, 0x100, { vk: 0x56, flags: 0 })).toBe(1); callback(0, 0x100, { vk: 0x56, flags: 0 }); await tick(); expect(next).not.toHaveBeenCalled(); expect(() => p.inject()).toThrow('apretada'); callback(0, 0x101, { vk: 0x56, flags: 0 }); await tick(); expect(next).toHaveBeenCalledTimes(1); callback(0, 0x100, { vk: 0x56, flags: 0 }); callback(0, 0x101, { vk: 0x56, flags: 0 }); await tick(); expect(next).toHaveBeenCalledTimes(2); p.stop() })
  it('does not re-enter its own injected inputs', async () => { const p = new WindowsPaste(); const next = vi.fn(); p.arm(next, () => {}, () => false); expect(native.callback!(0, 0x100, { vk: 0x56, flags: 0x10 })).toBe(0); await tick(); expect(next).not.toHaveBeenCalled(); p.stop() })
  it('tracks modifier events rather than querying stale asynchronous state inside the hook', async () => { const p = new WindowsPaste(); const next = vi.fn(); p.arm(next, () => {}, () => false); native.callback!(0, 0x100, { vk: 0xa0, flags: 0 }); expect(native.callback!(0, 0x100, { vk: 0x56, flags: 0 })).toBe(0); native.callback!(0, 0x101, { vk: 0xa0, flags: 0 }); native.callback!(0, 0x101, { vk: 0x11, flags: 0 }); expect(native.callback!(0, 0x100, { vk: 0x56, flags: 0 })).toBe(0); await tick(); expect(next).not.toHaveBeenCalled(); p.stop() })
  it('locks the first external target and cancels a paste after a target change', async () => { const p = new WindowsPaste(); const paused = vi.fn(); const next = vi.fn(); p.arm(next, paused, () => false); const callback = native.callback!; callback(0, 0x100, { vk: 0x56, flags: 0 }); callback(0, 0x101, { vk: 0x56, flags: 0 }); await tick(); native.foreground = '200'; expect(callback(0, 0x100, { vk: 0x56, flags: 0 })).toBe(1); callback(0, 0x101, { vk: 0x56, flags: 0 }); await tick(); expect(paused).toHaveBeenCalledTimes(1); expect(next).toHaveBeenCalledTimes(1); p.stop() })
  it('does not intercept paste in its own window', async () => { const p = new WindowsPaste(); const next = vi.fn(); p.arm(next, () => {}, () => true); expect(native.callback!(0, 0x100, { vk: 0x56, flags: 0 })).toBe(0); await tick(); expect(next).not.toHaveBeenCalled(); p.stop() })
  it('requires the locked foreground before injecting', () => { const p = new WindowsPaste(); p.arm(() => {}, () => {}, () => false); native.callback!(0, 0x100, { vk: 0x56, flags: 0 }); native.foreground = '200'; expect(() => p.inject()).toThrow('destino'); expect(native.sent).toBe(0); p.stop() })
  it('reports a failed hook installation and releases the callback slot', () => { native.failInstall = true; const p = new WindowsPaste(); expect(() => p.arm(() => {}, () => {}, () => false)).toThrow('rechazó'); expect(native.callback).toBeNull() })
  it('notifies pause on Esc and unregisters when stopped', async () => { const p = new WindowsPaste(); const paused = vi.fn(); p.arm(() => {}, paused, () => false); native.callback!(0, 0x100, { vk: 0x1b, flags: 0 }); await tick(); expect(paused).toHaveBeenCalledTimes(1); p.stop(); expect(native.callback).toBeNull(); expect(p.target).toBeNull() })
  it('swallows all held-V repeats even if Ctrl is released or the foreground changes', async () => { const p = new WindowsPaste(); const next = vi.fn(); p.arm(next, () => {}, () => false); const callback = native.callback!; callback(0, 0x100, { vk: 0x56, flags: 0 }); callback(0, 0x101, { vk: 0x11, flags: 0 }); native.modifiers.clear(); native.foreground = '200'; expect(callback(0, 0x100, { vk: 0x56, flags: 0 })).toBe(1); expect(callback(0, 0x101, { vk: 0x56, flags: 0 })).toBe(1); await tick(); expect(next).toHaveBeenCalledTimes(1); expect(() => p.inject()).toThrow('destino'); expect(native.sent).toBe(0); p.stop() })
  it('locks an external target for automatic delivery and refuses its own window', () => { const p = new WindowsPaste(); p.arm(() => {}, () => {}, () => false); expect(() => p.lockForeground(() => true)).toThrow('destino'); p.lockForeground(() => false); p.inject(); expect(native.sent).toBe(2); p.stop() })
})
