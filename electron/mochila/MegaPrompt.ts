import { copyFile, mkdir, stat, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { basename, join, resolve, sep } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { MochilaEntry } from '../../shared/mochila'

export interface MegaPlan {
  id: string
  queueIds: string[]
  entryIds: string[]
  directory: string
  paths: string[]
  text: string
  preparedAt: string
  limit: number | null
}
export function planMatches(plan: MegaPlan, queue: MochilaEntry[]): boolean { return plan.queueIds.length === queue.length && plan.queueIds.every((id, i) => id === queue[i].id) }
const cleanName = (path: string) => basename(path).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(-160) || 'archivo'

export async function prepareMega(root: string, queue: MochilaEntry[], limit: number | null, owns: (path: string) => boolean): Promise<MegaPlan> {
  if (!queue.length) throw new Error('La mochila está vacía.')
  if (limit !== null && (!Number.isInteger(limit) || limit < 1 || limit > 1000)) throw new Error('Límite inválido.')
  const selected = queue.slice(0, limit ?? queue.length)
  const fileCount = selected.reduce((count, e) => count + (e.payload.kind === 'text' ? 0 : e.payload.paths.length), 0)
  if (fileCount > 999) throw new Error('La megacarga admite hasta 999 adjuntos más el documento de contexto.')
  const id = randomUUID(); const directory = join(resolve(root), id)
  if (!directory.startsWith(resolve(root) + sep)) throw new Error('Destino de preparación inválido.')
  // Validate sources before making any prepared package.
  for (const entry of selected) if (entry.payload.kind !== 'text') for (const path of entry.payload.paths) if (!owns(path) || !(await stat(path)).isFile()) throw new Error('Falta un adjunto gestionado; la cola se conserva.')
  await mkdir(directory, { recursive: true })
  const paths: string[] = []; const sections = ['# MegaPrompt\n\nContexto reunido por el usuario. Los bloques siguientes conservan el orden de la mochila.\n']
  let fileIndex = 0
  for (const [index, entry] of selected.entries()) {
    sections.push(`\n## Elemento ${index + 1} · ${entry.payload.kind === 'text' ? 'Texto' : 'Adjunto'}\n`)
    if (entry.payload.kind === 'text') sections.push(entry.payload.text)
    else for (const source of entry.payload.paths) {
      const name = `${String(++fileIndex).padStart(3, '0')}-${cleanName(source)}`
      const target = join(directory, name)
      // Copy-on-write where supported; independent file copies elsewhere.
      await copyFile(source, target, constants.COPYFILE_FICLONE)
      if ((await stat(source)).size !== (await stat(target)).size) throw new Error('Un adjunto cambió durante la preparación.')
      paths.push(target); sections.push(`Adjunto: ${name}`)
    }
  }
  const text = sections.join('\n\n') + '\n'
  const document = join(directory, '000-MegaPrompt.md'); await writeFile(document, text, { flag: 'wx' })
  const plan: MegaPlan = { id, queueIds: queue.map(e => e.id), entryIds: selected.map(e => e.id), directory, paths: [document, ...paths], text, preparedAt: new Date().toISOString(), limit }
  await writeFile(join(directory, 'manifest.json'), JSON.stringify({ schema: 1, entryIds: plan.entryIds, files: plan.paths.map(p => basename(p)), preparedAt: plan.preparedAt }, null, 2), { flag: 'wx' })
  return plan
}
