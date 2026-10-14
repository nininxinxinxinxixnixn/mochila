import koffi from 'koffi'
import { win32 } from 'node:path'

export function fileDropBuffer(paths: string[]): Buffer {
  if (!paths.length || paths.length > 1000 || paths.some(path => !win32.isAbsolute(path) || path.includes('\0'))) throw new Error('Lista de archivos inválida.')
  const header = Buffer.alloc(20); header.writeUInt32LE(20, 0); header.writeUInt32LE(1, 16)
  return Buffer.concat([header, Buffer.from(paths.join('\0') + '\0\0', 'utf16le')])
}

/** CF_HDROP directly, without a shell, child process, or a second bitmap channel. */
export class NativeFileClipboard {
  private readonly api: any
  constructor(private readonly owner: () => bigint | number) {
    const user = koffi.load('user32.dll'); const kernel = koffi.load('kernel32.dll')
    this.api = {
      open: user.func('int __stdcall OpenClipboard(uintptr_t owner)'),
      close: user.func('int __stdcall CloseClipboard()'),
      empty: user.func('int __stdcall EmptyClipboard()'),
      set: user.func('void * __stdcall SetClipboardData(uint32_t format, void *memory)'),
      alloc: kernel.func('void * __stdcall GlobalAlloc(uint32_t flags, size_t size)'),
      lock: kernel.func('void * __stdcall GlobalLock(void *memory)'),
      unlock: kernel.func('int __stdcall GlobalUnlock(void *memory)'),
      free: kernel.func('void * __stdcall GlobalFree(void *memory)')
    }
  }
  async write(paths: string[]): Promise<void> {
    const bytes = fileDropBuffer(paths); const owner = this.owner()
    if (!owner) throw new Error('No hay una ventana propietaria para el portapapeles.')
    const memory = this.api.alloc(0x42, bytes.length)
    if (!memory) throw new Error('Windows no pudo reservar memoria para los adjuntos.')
    let opened = false; let transferred = false
    try {
      const pointer = this.api.lock(memory)
      if (!pointer) throw new Error('No se pudo preparar la lista de archivos.')
      try { koffi.encode(pointer, 'uint8_t', bytes, bytes.length) } finally { this.api.unlock(memory) }
      const deadline = Date.now() + 800
      while (!(opened = !!this.api.open(owner))) {
        if (Date.now() >= deadline) throw new Error('El portapapeles está ocupado. No se consumió la entrega.')
        await new Promise(done => setTimeout(done, 15))
      }
      if (!this.api.empty() || !this.api.set(15, memory)) throw new Error('Windows rechazó los adjuntos.')
      transferred = true
    } finally {
      if (opened) this.api.close()
      if (!transferred) this.api.free(memory)
    }
  }
}
