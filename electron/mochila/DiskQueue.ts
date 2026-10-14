import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { validateDocument } from './QueueModel'
import type { MochilaDocument } from '../../shared/mochila'
export interface QueueCodec { encode(text: string): Buffer; decode(data: Buffer): string }
export class DiskQueue {
  constructor(readonly file: string, private readonly codec: QueueCodec) {}
  load(): MochilaDocument {
    if (!existsSync(this.file)) return { schema: 1, queue: [], history: [] }
    return validateDocument(JSON.parse(this.codec.decode(readFileSync(this.file))))
  }
  save(document: MochilaDocument): void {
    validateDocument(document); mkdirSync(dirname(this.file), { recursive: true })
    const temp = `${this.file}.pending`
    writeFileSync(temp, this.codec.encode(JSON.stringify(document)), { mode: 0o600 })
    renameSync(temp, this.file)
  }
}
