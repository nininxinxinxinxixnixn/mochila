import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { basename, join, resolve, sep } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { ItemData } from '../../shared/types'
import type { MochilaEntry } from '../../shared/mochila'

/** Every accepted file becomes a managed COPY. Never move/delete a source. */
export class AssetVault {
  constructor(readonly root: string) {}
  owns(file: string): boolean {
    const base = resolve(this.root); const p = resolve(file)
    return p.startsWith(base + sep)
  }
  async capture(data: ItemData, source: MochilaEntry['source'], png?: Buffer): Promise<MochilaEntry> {
    const id = randomUUID(); const folder = join(this.root, id)
    const entry: MochilaEntry = { id, title: '', createdAt: new Date().toISOString(), payload: { kind: 'text', text: '' }, bytes: 0, source }
    if (data.kind === 'text') {
      entry.title = data.text.replace(/\s+/g, ' ').slice(0, 70) || 'Texto'
      entry.payload = { kind: 'text', text: data.text, html: data.html }
      entry.bytes = Buffer.byteLength(data.text, 'utf8')
      return entry
    }
    await mkdir(folder, { recursive: true })
    if (data.kind === 'image') {
      if (!png?.length) throw new Error('La captura no contiene una imagen recuperable.')
      const name = basename(data.fileName || `Captura-${id.slice(0, 8)}.png`)
      const file = join(folder, name.toLowerCase().endsWith('.png') ? name : `${name}.png`)
      await writeFile(file, png, { flag: 'wx' })
      entry.title = basename(file); entry.bytes = png.length; entry.payload = { kind: 'image', paths: [file] }
      return entry
    }
    if (data.kind !== 'files') throw new Error('Ese formato aún no se admite. Agregá los archivos originales.')
    if (!data.paths.length || data.paths.length > 100) throw new Error('Cada ingreso admite de 1 a 100 archivos.')
    const paths: string[] = []
    for (const [index, original] of data.paths.entries()) {
      const sourcePath = resolve(original)
      const info = await stat(sourcePath)
      if (!info.isFile()) throw new Error('Esta versión admite archivos individuales; las carpetas requieren un paquete aparte.')
      const targetDir = join(folder, String(index)); await mkdir(targetDir)
      const target = join(targetDir, basename(sourcePath)); await copyFile(sourcePath, target)
      const copied = await stat(target)
      const after = await stat(sourcePath)
      if (copied.size !== info.size || after.size !== info.size || after.mtimeMs !== info.mtimeMs) throw new Error('El archivo cambió durante el ingreso. Volvé a agregarlo.')
      entry.bytes += copied.size; paths.push(target)
    }
    entry.title = paths.length === 1 ? basename(paths[0]) : `${paths.length} archivos`
    entry.payload = { kind: 'files', paths }; return entry
  }
  async preview(entry: MochilaEntry): Promise<string | null> {
    if (entry.payload.kind !== 'image') return null
    const p = entry.payload.paths[0]
    if (!this.owns(p)) return null
    return `data:image/png;base64,${(await readFile(p)).toString('base64')}`
  }
}
