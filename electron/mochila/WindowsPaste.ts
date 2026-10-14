import koffi from 'koffi'

/** No hooks are installed until the user explicitly arms the queue. */
export class WindowsPaste {
  private api: any = null
  private hook: any = null
  private callback: any = null
  private vHeld = false
  private suppressed = false
  private triggerOnRelease = false
  private modifiers = new Set<number>()
  target: string | null = null
  constructor() {
    if (process.platform !== 'win32') return
    try {
      const lib = koffi.load('user32.dll')
      const proc = koffi.proto('intptr_t __stdcall MochilaKeyboardProc(int code, uintptr_t message, void *data)')
      this.api = {
        proc,
        keyboardData: koffi.struct({ vk: 'uint32_t', scan: 'uint32_t', flags: 'uint32_t', time: 'uint32_t', extra: 'uintptr_t' }),
        install: lib.func('void * __stdcall SetWindowsHookExW(int id, MochilaKeyboardProc *callback, void *module, uint32_t thread)'),
        next: lib.func('intptr_t __stdcall CallNextHookEx(void *hook, int code, uintptr_t message, void *data)'),
        unhook: lib.func('int __stdcall UnhookWindowsHookEx(void *hook)'),
        foreground: lib.func('uintptr_t __stdcall GetForegroundWindow()'),
        keyState: lib.func('int16_t __stdcall GetAsyncKeyState(int key)'),
        send: lib.func('uint32_t __stdcall SendInput(uint32_t count, const void *inputs, int size)')
      }
    } catch { this.api = null }
  }
  get ready(): boolean { return this.api !== null }
  foreground(): string { return this.api ? String(this.api.foreground()) : '0' }
  lockForeground(isOwnWindow: (hwnd: string) => boolean): void {
    const target = this.foreground()
    if (target === '0' || isOwnWindow(target)) throw new Error('Elegí el chat de destino antes de iniciar la descarga.')
    this.target = target
  }
  arm(onPaste: () => void, onPause: (reason: string) => void, isOwnWindow: (hwnd: string) => boolean): void {
    this.stop()
    if (!this.api) throw new Error('No está disponible el motor de Ctrl+V de Windows.')
    const modifierKeys = [0x11, 0xa2, 0xa3, 0x10, 0xa0, 0xa1, 0x12, 0xa4, 0xa5, 0x5b, 0x5c]
    // Seed outside the hook. GetAsyncKeyState is stale inside LowLevelKeyboardProc.
    this.modifiers = new Set(modifierKeys.filter(key => this.api.keyState(key) & 0x8000))
    this.callback = koffi.register((code: number, message: number, data: unknown) => {
      const forward = () => this.api.next(this.hook, code, message, data)
      if (code < 0) return forward()
      const event = koffi.decode(data as any, this.api.keyboardData) as { vk: number; flags: number }
      if (event.flags & 0x10) return forward() // injected inputs must never re-enter the queue
      const down = message === 0x100 || message === 0x104
      const up = message === 0x101 || message === 0x105
      if (modifierKeys.includes(event.vk)) {
        if (down) this.modifiers.add(event.vk)
        if (up) {
          this.modifiers.delete(event.vk)
          if ([0x11, 0xa2, 0xa3].includes(event.vk)) this.modifiers.delete(0x11)
          if ([0x10, 0xa0, 0xa1].includes(event.vk)) this.modifiers.delete(0x10)
          if ([0x12, 0xa4, 0xa5].includes(event.vk)) this.modifiers.delete(0x12)
          if (event.vk === 0x11) { this.modifiers.delete(0xa2); this.modifiers.delete(0xa3) }
          if (event.vk === 0x10) { this.modifiers.delete(0xa0); this.modifiers.delete(0xa1) }
          if (event.vk === 0x12) { this.modifiers.delete(0xa4); this.modifiers.delete(0xa5) }
        }
        return forward()
      }
      if (down && event.vk === 0x1b) { setImmediate(() => onPause('Pausado con Esc.')); return forward() }
      if (event.vk !== 0x56) return forward()
      if (up) {
        this.vHeld = false
        if (!this.suppressed) return forward()
        const trigger = this.triggerOnRelease
        this.suppressed = false; this.triggerOnRelease = false
        if (trigger) setImmediate(onPaste)
        return 1
      }
      // Keep repeats swallowed even if modifiers/focus change while V is held.
      if (down && this.suppressed) return 1
      if (!down || ![0x11, 0xa2, 0xa3].some(key => this.modifiers.has(key))) return forward()
      if ([0x10, 0xa0, 0xa1, 0x12, 0xa4, 0xa5, 0x5b, 0x5c].some(key => this.modifiers.has(key))) return forward()
      const target = this.foreground()
      if (target === '0' || isOwnWindow(target)) return forward()
      if (this.target !== null && this.target !== target) { this.vHeld = true; this.suppressed = true; this.triggerOnRelease = false; setImmediate(() => onPause('Cambió la ventana de destino; esta pulsación se canceló y la cola se pausó.')); return 1 }
      this.target = target; this.suppressed = true
      this.vHeld = true; this.triggerOnRelease = true
      return 1
    }, koffi.pointer(this.api.proc))
    this.hook = this.api.install(13, this.callback, null, 0)
    if (!this.hook) { koffi.unregister(this.callback); this.callback = null; throw new Error('Windows rechazó el atajo. La cola permanece pausada.') }
  }
  async waitForRelease(): Promise<void> {
    const deadline = Date.now() + 2500
    while (this.vHeld) {
      if (!this.hook || Date.now() > deadline) throw new Error('Soltá V antes de pegar. La entrega se pausó.')
      await new Promise(done => setTimeout(done, 15))
    }
  }
  inject(): void {
    if (!this.target || this.foreground() !== this.target) throw new Error('El destino cambió antes del pegado.')
    if (this.vHeld) throw new Error('No se inyecta el pegado mientras V sigue apretada.')
    const ctrlHeld = (this.api.keyState(0x11) & 0x8000) !== 0
    const keys = ctrlHeld ? [[0x56, 0], [0x56, 2]] : [[0x11, 0], [0x56, 0], [0x56, 2], [0x11, 2]]
    const size = process.arch === 'x64' || process.arch === 'arm64' ? 40 : 28
    const offset = size === 40 ? 8 : 4
    const input = Buffer.alloc(size * keys.length)
    keys.forEach(([key, flags], i) => { input.writeUInt32LE(1, i * size); input.writeUInt16LE(key, i * size + offset); input.writeUInt32LE(flags, i * size + offset + 4) })
    if (this.api.send(keys.length, input, size) !== keys.length) throw new Error('Windows no aceptó todas las teclas. Recepción NO VERIFICADA; no repetir automáticamente.')
  }
  stop(): void {
    if (this.hook && this.api) this.api.unhook(this.hook)
    this.hook = null
    if (this.callback) koffi.unregister(this.callback)
    this.callback = null; this.vHeld = false; this.suppressed = false; this.triggerOnRelease = false; this.modifiers.clear(); this.target = null
  }
}
