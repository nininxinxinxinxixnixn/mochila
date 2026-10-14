import type { MochilaEntry } from '../../shared/mochila'
export interface ClipboardWriterPorts {
  assertStoredFile(path: string): Promise<void>
  writeText(text: string): void
  writeImageFile(path: string): void
  writeFiles(paths: string[]): Promise<void>
}
/** One logical channel per paste. A capture never advertises CF_HDROP as well. */
export class ClipboardWriter {
  constructor(private readonly ports: ClipboardWriterPorts) {}
  async write(entry: MochilaEntry): Promise<void> {
    if (entry.payload.kind === 'text') { this.ports.writeText(entry.payload.text); return }
    for (const path of entry.payload.paths) await this.ports.assertStoredFile(path)
    if (entry.payload.kind === 'image') {
      if (entry.payload.paths.length !== 1) throw new Error('Una captura debe contener exactamente una imagen.')
      this.ports.writeImageFile(entry.payload.paths[0]); return
    }
    await this.ports.writeFiles(entry.payload.paths)
  }
}
