/** Zipper transitions share the existing capture and paste engine. */
export interface ZipperPorts {
  capturing(): boolean
  busy(): boolean
  delivering(): boolean
  hasItems(): boolean
  capture(enabled: boolean): void
  arm(limit: number | null): void
}

export class ZipperControl {
  constructor(private readonly ports: ZipperPorts) {}

  toggle(limit: number | null): void {
    if (this.ports.busy()) throw new Error('Esperá a que termine el guardado antes de mover el cierre.')
    if (!this.ports.capturing()) { this.ports.capture(true); return }
    if (limit !== null && (!Number.isInteger(limit) || limit < 1 || limit > 1000)) throw new Error('El límite debe estar entre 1 y 1000.')
    this.ports.capture(false)
    // Closing an empty backpack never installs a global keyboard hook.
    if (this.ports.hasItems()) this.ports.arm(limit)
  }

  receiveDrop(): void {
    if (this.ports.delivering()) throw new Error('Hay una entrega en curso. Esperá antes de soltar archivos.')
    // Do not re-seed the clipboard watcher if collection is already active.
    if (!this.ports.capturing()) this.ports.capture(true)
  }
}
