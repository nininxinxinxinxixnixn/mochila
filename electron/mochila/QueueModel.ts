import type { MochilaDocument, MochilaEntry } from '../../shared/mochila'

function isEntry(value: unknown): value is MochilaEntry {
  if (!value || typeof value !== 'object') return false
  const e = value as Partial<MochilaEntry>
  if (typeof e.id !== 'string' || !e.id || typeof e.title !== 'string' || typeof e.createdAt !== 'string' || typeof e.bytes !== 'number' || e.bytes < 0) return false
  if (!['clipboard', 'drop', 'manual'].includes(e.source ?? '')) return false
  const p = e.payload
  if (!p || typeof p !== 'object') return false
  if (p.kind === 'text') return typeof p.text === 'string' && (p.html === undefined || typeof p.html === 'string')
  return (p.kind === 'image' || p.kind === 'files') && Array.isArray(p.paths) && p.paths.length > 0 && p.paths.every(x => typeof x === 'string' && x.length > 0)
}
export function validateDocument(value: unknown): MochilaDocument {
  if (!value || typeof value !== 'object') throw new Error('Documento de cola inválido; se conserva el archivo original.')
  const d = value as MochilaDocument
  if (d.schema !== 1 || !Array.isArray(d.queue) || !Array.isArray(d.history) || !d.queue.every(isEntry)) throw new Error('Versión o estructura de cola no admitida.')
  if (!d.history.every(h => h && isEntry(h.entry) && typeof h.attemptedAt === 'string' && ['attempted', 'human-confirmed'].includes(h.status))) throw new Error('Historial inválido.')
  if (d.removed !== undefined && (!Array.isArray(d.removed) || !d.removed.every(r => r && isEntry(r.entry) && typeof r.removedAt === 'string' && Number.isInteger(r.queueIndex) && r.queueIndex >= 0 && Number.isInteger(r.intakeIndex) && r.intakeIndex >= 0))) throw new Error('Registro de quitados inválido.')
  const ids = [...d.queue.map(e => e.id), ...d.history.map(h => h.entry.id), ...(d.removed ?? []).map(r => r.entry.id)]
  if (new Set(ids).size !== ids.length) throw new Error('IDs duplicados en la cola; recuperación manual necesaria.')
  if (d.intakeOrder !== undefined && (!Array.isArray(d.intakeOrder) || new Set(d.intakeOrder).size !== d.intakeOrder.length || !d.intakeOrder.every(id => typeof id === 'string'))) throw new Error('Orden de ingreso inválido.')
  return structuredClone(d)
}

/** Save first, then commit memory. A failed write cannot consume an entry. */
export class QueueModel {
  private document: MochilaDocument
  armed = false
  limit: number | null = null
  remaining: number | null = null
  constructor(value: MochilaDocument, private readonly save: (value: MochilaDocument) => void) {
    this.document = validateDocument(value)
  }
  snapshot(): MochilaDocument { return structuredClone(this.document) }
  first(): MochilaEntry | undefined { return this.snapshot().queue[0] }
  private commit(next: MochilaDocument): void { this.save(next); this.document = next }
  private order(next: MochilaDocument): string[] {
    const ids = new Set(next.queue.map(e => e.id))
    const existing = (next.intakeOrder ?? []).filter(id => ids.has(id))
    const known = new Set(existing)
    // Older versions preserve optional fields but do not update them.
    return [...existing, ...[...next.queue].filter(e => !known.has(e.id)).sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map(e => e.id)]
  }
  add(entry: MochilaEntry): void {
    if (!isEntry(entry)) throw new Error('Elemento inválido.')
    const next = this.snapshot()
    if ([...next.queue, ...next.history.map(h => h.entry), ...(next.removed ?? []).map(r => r.entry)].some(e => e.id === entry.id)) throw new Error('La ocurrencia ya existe.')
    next.intakeOrder = [...this.order(next), entry.id]
    next.queue.push(structuredClone(entry)); this.commit(next)
  }
  arm(limit: number | null): void {
    if (!this.document.queue.length) throw new Error('La mochila está vacía.')
    if (limit !== null && (!Number.isInteger(limit) || limit < 1 || limit > 1000)) throw new Error('El límite debe estar entre 1 y 1000.')
    this.limit = limit; this.remaining = limit; this.armed = true
  }
  pause(): void { this.armed = false }
  move(id: string, delta: number): void {
    this.pause()
    if (delta !== -1 && delta !== 1) throw new Error('Movimiento inválido.')
    const next = this.snapshot(); const i = next.queue.findIndex(e => e.id === id); const j = i + delta
    if (i < 0) throw new Error('Elemento no encontrado.')
    if (j < 0 || j >= next.queue.length) return
    next.intakeOrder = this.order(next)
    ;[next.queue[i], next.queue[j]] = [next.queue[j], next.queue[i]]; this.commit(next)
  }
  /** Persist before injection. This records an attempt, never receipt. */
  attempted(id: string): void {
    if (!this.armed || this.document.queue[0]?.id !== id) throw new Error('La cola cambió durante la entrega.')
    const next = this.snapshot(); next.intakeOrder = this.order(next).filter(x => x !== id); const entry = next.queue.shift()!
    next.history.push({ entry, attemptedAt: new Date().toISOString(), status: 'attempted' }); this.commit(next)
    if (this.remaining !== null) this.remaining--
    if (!next.queue.length || this.remaining === 0) this.pause()
  }
  attemptedBatch(ids: string[]): void {
    if (!this.armed || !ids.length || ids.some((id, i) => this.document.queue[i]?.id !== id)) throw new Error('La cola cambió desde la preparación.')
    if (this.remaining !== null && ids.length > this.remaining) throw new Error('El lote supera el freno elegido.')
    const next = this.snapshot(); next.intakeOrder = this.order(next).filter(id => !ids.includes(id))
    const entries = next.queue.splice(0, ids.length); const attemptedAt = new Date().toISOString()
    next.history.push(...entries.map(entry => ({ entry, attemptedAt, status: 'attempted' as const }))); this.commit(next)
    if (this.remaining !== null) this.remaining -= ids.length
    if (!next.queue.length || this.remaining === 0) this.pause()
  }
  undo(): void {
    this.pause(); const next = this.snapshot(); const delivery = next.history.pop()
    if (!delivery) return
    next.intakeOrder = [delivery.entry.id, ...this.order(next)]; next.queue.unshift(delivery.entry); this.commit(next)
  }
  remove(id: string): void {
    this.pause(); const next = this.snapshot(); const index = next.queue.findIndex(e => e.id === id)
    if (index < 0) throw new Error('El elemento ya no está pendiente.')
    const order = this.order(next)
    next.removed = [...(next.removed ?? []), { entry: next.queue[index], removedAt: new Date().toISOString(), queueIndex: index, intakeIndex: order.indexOf(id) }]
    next.intakeOrder = order.filter(x => x !== id); next.queue.splice(index, 1); this.commit(next)
  }
  undoIntake(): void {
    const latest = this.order(this.snapshot()).at(-1)
    if (latest) this.remove(latest)
  }
  restoreRemoved(): void {
    this.pause(); const next = this.snapshot(); const removed = next.removed?.pop()
    if (!removed) return
    const order = this.order(next); order.splice(Math.min(removed.intakeIndex, order.length), 0, removed.entry.id); next.intakeOrder = order
    next.queue.splice(Math.min(removed.queueIndex, next.queue.length), 0, removed.entry); this.commit(next)
  }
  confirm(id: string): void {
    const next = this.snapshot(); const h = next.history.find(e => e.entry.id === id)
    if (!h) throw new Error('Intento no encontrado.')
    h.status = 'human-confirmed'; this.commit(next)
  }
}
