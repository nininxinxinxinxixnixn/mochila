import { describe, expect, it, vi } from 'vitest'
import { ZipperControl } from '../electron/mochila/ZipperControl'
import { QueueModel } from '../electron/mochila/QueueModel'
const entry = (id: string) => ({ id, title: id, createdAt: new Date().toISOString(), bytes: 2, source: 'manual' as const, payload: { kind: 'text' as const, text: id } })
function fixture(items = ['a', 'b']) {
  const queue = new QueueModel({ schema: 1, queue: items.map(entry), history: [] }, () => {})
  const flags = { capturing: false, busy: false, delivering: false }
  const capture = vi.fn((enabled: boolean) => { queue.pause(); flags.capturing = enabled })
  const arm = vi.fn((limit: number | null) => queue.arm(limit))
  const zipper = new ZipperControl({ capturing: () => flags.capturing, busy: () => flags.busy, delivering: () => flags.delivering, hasItems: () => !!queue.first(), capture, arm })
  return { queue, flags, capture, arm, zipper }
}
describe('zipper and direct intake on the real queue model', () => {
  it('opens collection, closes to FIFO delivery, stops at a selected limit, and preserves history', () => {
    const f = fixture(); f.zipper.toggle(1); expect(f.flags.capturing).toBe(true); expect(f.queue.armed).toBe(false)
    f.zipper.toggle(1); expect(f.flags.capturing).toBe(false); expect(f.queue.armed).toBe(true)
    f.queue.attempted('a'); expect(f.queue.armed).toBe(false); expect(f.queue.snapshot().queue.map(e => e.id)).toEqual(['b']); expect(f.queue.snapshot().history[0].status).toBe('attempted')
    f.zipper.toggle(null); expect(f.flags.capturing).toBe(true); expect(f.queue.snapshot().history).toHaveLength(1)
  })
  it('closing an empty backpack does not arm the native paste engine', () => { const f = fixture([]); f.zipper.toggle(null); f.zipper.toggle(null); expect(f.flags.capturing).toBe(false); expect(f.arm).not.toHaveBeenCalled() })
  it('a drop during armed delivery returns to collection without consuming the head', () => { const f = fixture(); f.zipper.toggle(null); f.zipper.toggle(null); f.zipper.receiveDrop(); f.queue.add(entry('pdf')); expect(f.queue.armed).toBe(false); expect(f.flags.capturing).toBe(true); expect(f.queue.snapshot().queue.map(e => e.id)).toEqual(['a', 'b', 'pdf']) })
  it('successive drops do not reseed an already running clipboard watcher', () => { const f = fixture(); f.zipper.receiveDrop(); f.flags.busy = true; f.zipper.receiveDrop(); expect(f.capture).toHaveBeenCalledTimes(1) })
  it('refuses to close while a file snapshot is still being saved', () => { const f = fixture(); f.zipper.toggle(null); f.flags.busy = true; expect(() => f.zipper.toggle(null)).toThrow('guardado'); expect(f.flags.capturing).toBe(true); expect(f.arm).not.toHaveBeenCalled() })
  it('does not reopen capture during an in-flight delivery', () => { const f = fixture(); f.flags.delivering = true; expect(() => f.zipper.receiveDrop()).toThrow('entrega'); expect(f.capture).not.toHaveBeenCalled(); expect(f.queue.first()?.id).toBe('a') })
  it('keeps the closed queue paused if Windows rejects arming', () => { const f = fixture(); f.zipper.toggle(null); f.arm.mockImplementation(() => { throw new Error('Windows rechazó el atajo') }); expect(() => f.zipper.toggle(null)).toThrow('rechazó'); expect(f.flags.capturing).toBe(false); expect(f.queue.armed).toBe(false); expect(f.queue.snapshot().queue).toHaveLength(2) })
  it('rejects an invalid delivery limit before turning off capture', () => { const f = fixture(); f.zipper.toggle(null); expect(() => f.zipper.toggle(-1)).toThrow('límite'); expect(f.flags.capturing).toBe(true); expect(f.arm).not.toHaveBeenCalled() })
})
