/** Mochila additions, 2026. Queue occurrences stay separate from reusable assets. */
export type MochilaPayload =
  | { kind: 'text'; text: string; html?: string }
  | { kind: 'image'; paths: string[] }
  | { kind: 'files'; paths: string[] }
export interface MochilaEntry {
  id: string
  title: string
  createdAt: string
  payload: MochilaPayload
  bytes: number
  source: 'clipboard' | 'drop' | 'manual'
}
export interface MochilaDelivery {
  entry: MochilaEntry
  attemptedAt: string
  status: 'attempted' | 'human-confirmed'
}
export interface MochilaDocument {
  schema: 1
  queue: MochilaEntry[]
  history: MochilaDelivery[]
  intakeOrder?: string[]
  removed?: { entry: MochilaEntry; removedAt: string; queueIndex: number; intakeIndex: number }[]
}
export interface MochilaView extends MochilaDocument {
  capturing: boolean
  armed: boolean
  busy: boolean
  limit: number | null
  remaining: number | null
  error: string | null
  expanded: boolean
  nativeReady: boolean
  targetLocked: boolean
  countdown: number
  automatic: boolean
  mega: { count: number; files: number; valid: boolean; preparedAt: string; limit: number | null } | null
}
export type MochilaCommand =
  | { type: 'zipper'; limit: number | null }
  | { type: 'drop-text'; text: string }
  | { type: 'capture'; enabled: boolean }
  | { type: 'arm'; limit: number | null }
  | { type: 'pause' }
  | { type: 'start-auto'; limit: number | null }
  | { type: 'prepare-mega'; limit: number | null }
  | { type: 'send-mega' }
  | { type: 'reveal-mega' }
  | { type: 'move'; id: string; delta: number }
  | { type: 'undo' }
  | { type: 'undo-intake' }
  | { type: 'remove'; id: string }
  | { type: 'restore-removed' }
  | { type: 'confirm'; id: string }
  | { type: 'text'; text: string }
  | { type: 'choose-files' }
  | { type: 'expand'; expanded: boolean }
  | { type: 'reveal' }
  | { type: 'quit' }
export interface MochilaApi {
  load(): Promise<MochilaView>
  command(command: MochilaCommand): Promise<MochilaView>
  dropFiles(paths: string[]): Promise<MochilaView>
  preview(id: string): Promise<string | null>
  movePet(phase: 'start' | 'move' | 'end'): Promise<void>
  onState(callback: (state: MochilaView) => void): () => void
}
