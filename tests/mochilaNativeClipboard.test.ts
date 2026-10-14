import { beforeEach, describe, expect, it, vi } from 'vitest'
const native = vi.hoisted(() => ({ opened: 0, closed: 0, freed: 0, set: 0, buffer: Buffer.alloc(0), failSet: false, failLock: false, formats: [] as number[] }))
vi.mock('koffi', () => ({ default: { load: () => ({ func: (signature: string) => {
  if (signature.includes('OpenClipboard')) return () => { native.opened++; return 1 }
  if (signature.includes('CloseClipboard')) return () => { native.closed++; return 1 }
  if (signature.includes('EmptyClipboard')) return () => 1
  if (signature.includes('SetClipboardData')) return (format: number) => { native.set++; native.formats.push(format); return native.failSet ? null : 100 }
  if (signature.includes('GlobalAlloc')) return () => 100
  if (signature.includes('GlobalLock')) return () => native.failLock ? null : 200
  if (signature.includes('GlobalUnlock')) return () => 1
  if (signature.includes('GlobalFree')) return () => { native.freed++; return null }
  throw new Error('unknown binding')
} }), encode: (_p: unknown, _type: string, bytes: Buffer) => { native.buffer = Buffer.from(bytes) } } }))
import { fileDropBuffer, NativeFileClipboard } from '../electron/mochila/NativeFileClipboard'
beforeEach(() => { Object.assign(native, { opened: 0, closed: 0, freed: 0, set: 0, buffer: Buffer.alloc(0), failSet: false, failLock: false, formats: [] }) })
describe('native file list contract without touching the OS clipboard', () => {
  it('builds CF_HDROP with a 20-byte header, wide paths, and a double terminator', () => { const buffer = fileDropBuffer(['C:\\Mochila\\ñ.png', 'C:\\Mochila\\x.pdf']); expect(buffer.readUInt32LE(0)).toBe(20); expect(buffer.readUInt32LE(16)).toBe(1); expect(buffer.subarray(20).toString('utf16le')).toBe('C:\\Mochila\\ñ.png\0C:\\Mochila\\x.pdf\0\0') })
  it('rejects relative paths and embedded nulls before allocating memory', () => { expect(() => fileDropBuffer(['relative.png'])).toThrow(); expect(() => fileDropBuffer(['C:\\x\0.png'])).toThrow(); expect(() => fileDropBuffer([])).toThrow() })
  it('transfers memory ownership exactly once to Windows and closes the clipboard', async () => { const writer = new NativeFileClipboard(() => 42); await writer.write(['C:\\Mochila\\x.png']); expect(native.formats).toEqual([15]); expect(native.closed).toBe(1); expect(native.freed).toBe(0); expect(native.buffer.subarray(20).toString('utf16le')).toBe('C:\\Mochila\\x.png\0\0') })
  it('frees untransferred memory and closes on SetClipboardData failure', async () => { native.failSet = true; await expect(new NativeFileClipboard(() => 42).write(['C:\\x.png'])).rejects.toThrow(); expect(native.closed).toBe(1); expect(native.freed).toBe(1) })
  it('does not touch the clipboard if memory locking or the owner is invalid', async () => { native.failLock = true; await expect(new NativeFileClipboard(() => 42).write(['C:\\x.png'])).rejects.toThrow(); expect(native.opened).toBe(0); expect(native.freed).toBe(1); await expect(new NativeFileClipboard(() => 0).write(['C:\\x.png'])).rejects.toThrow('propietaria'); expect(native.opened).toBe(0) })
})
