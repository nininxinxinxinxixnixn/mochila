import { expect, it } from 'vitest'
import { WindowsPaste } from '../electron/mochila/WindowsPaste'
import koffi from 'koffi'
import { NativeFileClipboard, fileDropBuffer } from '../electron/mochila/NativeFileClipboard'
it('resolves the Windows native bindings without installing a hook or sending keys', () => {
  const paste = new WindowsPaste()
  expect(paste.ready).toBe(process.platform === 'win32')
  expect(paste.target).toBeNull()
  paste.stop()
})
it('resolves direct file clipboard bindings without opening or clearing the clipboard', () => {
  const writer = new NativeFileClipboard(() => 0)
  expect(writer).toBeDefined()
})
it('encodes the actual CF_HDROP bytes into allocated Windows memory without using the clipboard', () => {
  const kernel = koffi.load('kernel32.dll')
  const alloc = kernel.func('void * __stdcall GlobalAlloc(uint32_t flags, size_t size)')
  const lock = kernel.func('void * __stdcall GlobalLock(void *memory)')
  const unlock = kernel.func('int __stdcall GlobalUnlock(void *memory)')
  const free = kernel.func('void * __stdcall GlobalFree(void *memory)')
  const bytes = fileDropBuffer(['C:\\synthetic\\ñ.png'])
  const memory = alloc(0x42, bytes.length)
  expect(memory).toBeTruthy()
  try {
    const pointer = lock(memory); expect(pointer).toBeTruthy()
    try { koffi.encode(pointer, 'uint8_t', bytes, bytes.length); expect(Buffer.from(koffi.decode(pointer, 'uint8_t', bytes.length))).toEqual(bytes) }
    finally { unlock(memory) }
  } finally { free(memory) }
})
