/** Mochila: independent runtime, reusing Edge-Drop's clipboard format engine. */
import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeImage, powerMonitor, safeStorage, screen, shell, Tray } from 'electron'
import { join, resolve } from 'node:path'
import { mkdirSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import koffi from 'koffi'
import { ClipboardWatcher } from '../clipboard/ClipboardWatcher'
import { psHost } from '../main/powershell'
import { AssetVault } from './AssetVault'
import { DiskQueue } from './DiskQueue'
import { QueueModel } from './QueueModel'
import { WindowsPaste } from './WindowsPaste'
import { ZipperControl } from './ZipperControl'
import { ClipboardWriter } from './ClipboardWriter'
import { PasteCoordinator } from './PasteCoordinator'
import { NativeFileClipboard } from './NativeFileClipboard'
import { prepareMega, planMatches } from './MegaPrompt'
import type { MegaPlan } from './MegaPrompt'
import type { ItemData } from '../../shared/types'
import type { MochilaCommand, MochilaEntry, MochilaView } from '../../shared/mochila'

app.setName('Mochila')
const userData = process.env.MOCHILA_DATA_DIR ? resolve(process.env.MOCHILA_DATA_DIR) : join(app.getPath('appData'), 'Mochila')
mkdirSync(userData, { recursive: true }); app.setPath('userData', userData)
let win: BrowserWindow | null = null
let tray: Tray | null = null
let model: QueueModel
let vault: AssetVault
let paste: WindowsPaste
let capturing = false
let busy = false
let countdown = 0
let megaSending = false
let mega: MegaPlan | null = null
let dragOrigin: { x: number; y: number; left: number; top: number } | null = null
let fileClipboard: NativeFileClipboard
let expanded = false
let error: string | null = null
let storageBlocked = false
let generation = 0
let intake: Promise<void> = Promise.resolve()
let pendingIntakes = 0
const watcher = new ClipboardWatcher(300, 150)
const zipper = new ZipperControl({ capturing: () => capturing, busy: () => busy || countdown > 0 || pendingIntakes > 0, delivering: () => busy || countdown > 0, hasItems: () => !!model.first(), capture, arm })
const delivery = new PasteCoordinator(() => model.armed, pasteNext, handleError)
const writer = new ClipboardWriter({
  assertStoredFile: async path => { if (!vault.owns(path) || !(await stat(path)).isFile()) throw new Error('Falta un archivo guardado. El elemento se conserva en la cola.') },
  writeText: text => clipboard.writeText(text),
  writeImageFile: path => { const image = nativeImage.createFromPath(path); if (image.isEmpty()) throw new Error('La captura guardada no pudo leerse.'); clipboard.writeImage(image) },
  writeFiles
})

function view(): MochilaView {
  const d = model.snapshot()
  const preview = (e: MochilaEntry): MochilaEntry => e.payload.kind === 'text' ? { ...e, payload: { kind: 'text', text: e.payload.text.slice(0, 300) } } : e
  return { ...d, queue: d.queue.map(preview), history: d.history.map(h => ({ ...h, entry: preview(h.entry) })), removed: d.removed?.map(r => ({ ...r, entry: preview(r.entry) })), capturing, armed: model.armed, busy: busy || countdown > 0 || pendingIntakes > 0, countdown, automatic: delivery.automatic || megaSending, mega: mega ? { count: mega.entryIds.length, files: mega.paths.length, valid: planMatches(mega, d.queue), preparedAt: mega.preparedAt, limit: mega.limit } : null, limit: model.limit, remaining: model.remaining, error, expanded, nativeReady: paste.ready, targetLocked: paste.target !== null }
}
function push(): void { if (win && !win.isDestroyed()) win.webContents.send('mochila:state', view()) }
function pause(reason?: string): void { generation++; countdown = 0; megaSending = false; delivery.cancel(); model.pause(); paste.stop(); if (reason) error = reason; push() }
function handleError(e: unknown): void { capturing = false; watcher.setPaused(true); pause(e instanceof Error ? e.message : 'Ocurrió un error. Los pendientes se conservan.') }
function resize(next: boolean): void {
  expanded = next
  if (win) {
    const area = screen.getDisplayMatching(win.getBounds()).workArea
    const width = next ? 460 : 192; const height = next ? Math.min(780, area.height - 30) : 252
    const old = win.getBounds(); const right = Math.min(area.x + area.width, old.x + old.width)
    const bottom = Math.min(area.y + area.height, old.y + old.height)
    win.setBounds({ x: Math.max(area.x, right - width), y: Math.max(area.y, bottom - height), width, height })
    win.setFocusable(next); win.showInactive()
  }
  push()
}
async function ingest(data: ItemData, source: MochilaEntry['source'], png?: Buffer): Promise<void> {
  if (storageBlocked) throw new Error('El índice necesita recuperación; no se sobrescribe.')
  const entry = await vault.capture(data, source, png)
  model.add(entry); error = null; push()
}
function accept(data: ItemData, source: MochilaEntry['source'], png?: Buffer): Promise<void> {
  pendingIntakes++; push()
  const operation = intake.then(() => ingest(data, source, png))
  intake = operation.catch(handleError).finally(() => { pendingIntakes--; push() })
  return intake
}
function capture(enabled: boolean): void {
  if (enabled && storageBlocked) throw new Error('La cola está bloqueada por un índice inválido.')
  pause(); capturing = enabled
  if (enabled) {
    watcher.start((data, png) => { if (capturing) void accept(data, 'clipboard', png) })
    watcher.setPaused(false)
  } else watcher.setPaused(true)
  error = null; push()
}
async function writeFiles(paths: string[]): Promise<void> { await fileClipboard.write(paths) }
async function pasteNext(): Promise<void> {
  if (!model.armed || busy || countdown > 0 || megaSending) return
  const entry = model.first(); if (!entry) return
  busy = true; const token = generation; push()
  try {
    await writer.write(entry)
    await paste.waitForRelease()
    if (!model.armed || token !== generation) return
    if (paste.foreground() !== paste.target) throw new Error('Cambió el destino antes de soltar el elemento.')
    // Persist the attempt BEFORE injection. A crash cannot silently repeat it.
    model.attempted(entry.id)
    paste.inject()
    error = null
    // Throttle only; this is not an acknowledgement from the recipient.
    await new Promise(resolveWait => setTimeout(resolveWait, 750))
    if (!model.armed) paste.stop()
  } catch (e) { handleError(e) }
  finally { busy = false; push() }
}
function ownWindow(handle: string): boolean {
  return BrowserWindow.getAllWindows().some(w => {
    const b = w.getNativeWindowHandle()
    return String(b.length === 8 ? b.readBigUInt64LE(0) : b.readUInt32LE(0)) === handle
  })
}
function arm(limit: number | null): void {
  if (busy || countdown > 0 || pendingIntakes) throw new Error('Esperá a que termine el guardado antes de armar la cola.')
  if (storageBlocked) throw new Error('La cola necesita recuperación.')
  capturing = false; watcher.setPaused(true); generation++
  model.arm(limit)
  try { paste.arm(() => { if (!countdown && !megaSending) delivery.request() }, reason => pause(reason), ownWindow) }
  catch (e) { model.pause(); throw e }
  error = null; push()
}

async function countDown(token: number): Promise<boolean> {
  for (let n = 3; n > 0; n--) {
    if (generation !== token || !model.armed) return false
    countdown = n; push(); await new Promise(done => setTimeout(done, 1000))
  }
  if (generation !== token || !model.armed) return false
  countdown = 0; paste.lockForeground(ownWindow); push(); return true
}
function beginAutomatic(limit: number | null): void {
  arm(limit); const token = generation; countdown = 3; push()
  void countDown(token).then(ready => { if (ready) { delivery.startAutomatic(); push() } }).catch(handleError)
}
async function prepare(limit: number | null): Promise<void> {
  if (busy || countdown || pendingIntakes) throw new Error('Esperá a que termine el guardado o la entrega.')
  capture(false); busy = true; const token = generation; const snapshot = model.snapshot().queue; push()
  try {
    const plan = await prepareMega(join(userData, 'prepared'), snapshot, limit, path => vault.owns(path))
    if (generation !== token || !planMatches(plan, model.snapshot().queue)) throw new Error('La cola cambió; prepará de nuevo el MegaPrompt.')
    mega = plan; error = null
  } finally { busy = false; push() }
}
function beginMega(): void {
  const plan = mega
  if (!plan || !planMatches(plan, model.snapshot().queue)) throw new Error('Prepará el MegaPrompt con la cola actual.')
  arm(plan.entryIds.length); const token = generation; megaSending = true; countdown = 3; push()
  void (async () => {
    if (!(await countDown(token))) return
    busy = true; push()
    try {
      if (!planMatches(plan, model.snapshot().queue)) throw new Error('La cola cambió desde la preparación.')
      for (const path of plan.paths) if (!(await stat(path)).isFile()) throw new Error('Falta un archivo preparado; volvé a preparar.')
      await writeFiles(plan.paths); await paste.waitForRelease()
      if (token !== generation || !model.armed) return
      if (paste.foreground() !== paste.target) throw new Error('Cambió el destino; megacarga cancelada.')
      model.attemptedBatch(plan.entryIds); paste.inject(); error = null
      // One native paste exposes the prepared document and attachments together.
    } finally { busy = false; if (generation === token) pause(); push() }
  })().catch(handleError)
}

async function command(c: MochilaCommand): Promise<MochilaView> {
  try {
    if (!c || typeof c.type !== 'string') throw new Error('Orden inválida.')
    if (storageBlocked && !['expand', 'reveal', 'quit', 'pause'].includes(c.type)) throw new Error('Índice inválido. Se conserva sin modificar para recuperarlo.')
    if ((busy || countdown > 0 || pendingIntakes > 0) && ['start-auto', 'prepare-mega', 'send-mega', 'move', 'undo', 'undo-intake', 'remove', 'restore-removed', 'confirm', 'text', 'choose-files'].includes(c.type)) throw new Error('Hay una entrega o guardado en curso. Podés pausar; esperá antes de cambiar la cola.')
    switch (c.type) {
      case 'start-auto': beginAutomatic(c.limit); break
      case 'prepare-mega': await prepare(c.limit); break
      case 'send-mega': beginMega(); break
      case 'reveal-mega': if (mega) shell.showItemInFolder(join(mega.directory, '000-MegaPrompt.md')); break
      case 'zipper': zipper.toggle(c.limit); break
      case 'drop-text': if (typeof c.text !== 'string' || !c.text.trim() || c.text.length > 5_000_000) throw new Error('Ingresá texto de hasta 5 millones de caracteres.'); zipper.receiveDrop(); await accept({ kind: 'text', text: c.text, isUrl: false }, 'drop'); break
      case 'capture': if (typeof c.enabled !== 'boolean') throw new Error('Orden inválida.'); capture(c.enabled); break
      case 'arm': arm(c.limit); break
      case 'pause': pause(); break
      case 'move': if (typeof c.id !== 'string') throw new Error('ID inválido.'); pause(); model.move(c.id, c.delta); break
      case 'undo': pause(); model.undo(); error = null; break
      case 'undo-intake': pause(); model.undoIntake(); error = null; break
      case 'remove': if (typeof c.id !== 'string') throw new Error('ID inválido.'); pause(); model.remove(c.id); error = null; break
      case 'restore-removed': pause(); model.restoreRemoved(); error = null; break
      case 'confirm': if (typeof c.id !== 'string') throw new Error('ID inválido.'); model.confirm(c.id); error = null; break
      case 'text': if (typeof c.text !== 'string' || !c.text.trim() || c.text.length > 5_000_000) throw new Error('Ingresá texto de hasta 5 millones de caracteres.'); pause(); await accept({ kind: 'text', text: c.text, isUrl: false }, 'manual'); break
      case 'choose-files': { pause(); const selected = await dialog.showOpenDialog(win!, { title: 'Agregar a la mochila', properties: ['openFile', 'multiSelections'] }); if (!selected.canceled && selected.filePaths.length) { zipper.receiveDrop(); await accept({ kind: 'files', paths: selected.filePaths }, 'drop') } break }
      case 'expand': if (typeof c.expanded !== 'boolean') throw new Error('Orden inválida.'); resize(c.expanded); break
      case 'reveal': shell.showItemInFolder(join(userData, 'mochila.queue')); break
      case 'quit': app.quit(); break
      default: throw new Error('Orden no admitida.')
    }
  } catch (e) { handleError(e) }
  push(); return view()
}

if (!app.requestSingleInstanceLock()) app.quit()
else {
  app.on('second-instance', () => resize(true))
  app.whenReady().then(() => {
    app.setAppUserModelId('local.mochila.contexto')
    fileClipboard = new NativeFileClipboard(() => { const handle = win?.getNativeWindowHandle(); return handle ? (handle.length === 8 ? handle.readBigUInt64LE(0) : handle.readUInt32LE(0)) : 0 }); paste = new WindowsPaste(); vault = new AssetVault(join(userData, 'assets'))
    const codec = {
      encode: (text: string) => safeStorage.isEncryptionAvailable() ? Buffer.concat([Buffer.from('MQ1E'), safeStorage.encryptString(text)]) : Buffer.concat([Buffer.from('MQ1P'), Buffer.from(text)]),
      decode: (data: Buffer) => { const header = data.subarray(0, 4).toString(); if (header === 'MQ1E') return safeStorage.decryptString(data.subarray(4)); if (header === 'MQ1P') return data.subarray(4).toString(); throw new Error('El índice no tiene un formato válido.'); }
    }
    const disk = new DiskQueue(join(userData, 'mochila.queue'), codec)
    try { model = new QueueModel(disk.load(), d => disk.save(d)) }
    catch (e) { storageBlocked = true; error = e instanceof Error ? e.message : 'Índice no recuperable.'; model = new QueueModel({ schema: 1, queue: [], history: [] }, () => { throw new Error('Índice bloqueado.') }) }
    const area = screen.getPrimaryDisplay().workArea
    win = new BrowserWindow({ width: 192, height: 252, x: area.x + area.width - 212, y: area.y + area.height - 272, frame: false, transparent: true, alwaysOnTop: true, resizable: false, skipTaskbar: true, show: false, focusable: false, title: 'Mochila', webPreferences: { preload: join(__dirname, '../preload/index.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } })
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    win.webContents.on('will-navigate', e => e.preventDefault())
    win.webContents.session.setPermissionRequestHandler((_web, _permission, cb) => cb(false))
    ipcMain.handle('mochila:load', e => { if (e.sender !== win?.webContents) throw new Error('Receptor incorrecto.'); return view() })
    ipcMain.handle('mochila:command', (e, c: MochilaCommand) => { if (e.sender !== win?.webContents) throw new Error('Receptor incorrecto.'); return command(c) })
    ipcMain.handle('mochila:files', async (e, paths: unknown) => {
      if (e.sender !== win?.webContents) throw new Error('Receptor incorrecto.')
      try {
        if (!Array.isArray(paths) || !paths.every(p => typeof p === 'string') || !paths.length || paths.length > 100) throw new Error('Lista de archivos inválida.')
        zipper.receiveDrop(); await accept({ kind: 'files', paths }, 'drop')
      } catch (err) { handleError(err) }
      return view()
    })
    ipcMain.handle('mochila:move', (e, phase: unknown) => {
      if (e.sender !== win?.webContents || !win || !['start', 'move', 'end'].includes(String(phase))) throw new Error('Movimiento inválido.')
      if (phase === 'end') { dragOrigin = null; return }
      const pointer = screen.getCursorScreenPoint()
      if (phase === 'start') { const bounds = win.getBounds(); dragOrigin = { ...pointer, left: bounds.x, top: bounds.y }; return }
      if (!dragOrigin) return
      const area = screen.getDisplayNearestPoint(pointer).workArea; const bounds = win.getBounds()
      const left = Math.max(area.x, Math.min(area.x + area.width - bounds.width, dragOrigin.left + pointer.x - dragOrigin.x))
      const top = Math.max(area.y, Math.min(area.y + area.height - bounds.height, dragOrigin.top + pointer.y - dragOrigin.y))
      win.setPosition(Math.round(left), Math.round(top))
    })
    ipcMain.handle('mochila:preview', (e, id: unknown) => {
      if (e.sender !== win?.webContents || typeof id !== 'string') throw new Error('Receptor o ID incorrecto.')
      const state = model.snapshot(); const entry = state.queue.find(x => x.id === id) ?? state.history.find(x => x.entry.id === id)?.entry
      if (!entry || entry.payload.kind !== 'image' || !vault.owns(entry.payload.paths[0])) return null
      try { return nativeImage.createFromPath(entry.payload.paths[0]).resize({ width: 180 }).toDataURL() } catch { return null }
    })
    try {
      const user32 = koffi.load('user32.dll')
      const add = user32.func('int AddClipboardFormatListener(uintptr_t window)')
      const handle = win.getNativeWindowHandle(); const hwnd = handle.length === 8 ? handle.readBigUInt64LE(0) : handle.readUInt32LE(0)
      add(hwnd); win.hookWindowMessage(0x031d, () => watcher.nudge())
    } catch { /* polling fallback remains part of the upstream capture engine */ }
    win.once('ready-to-show', () => win?.showInactive())
    const dev = process.env.ELECTRON_RENDERER_URL
    if (dev) void win.loadURL(`${dev.replace(/\/$/, '')}/mochila.html`)
    else void win.loadFile(join(__dirname, '../renderer/mochila.html'))
    const icon = nativeImage.createFromPath(join(app.getAppPath(), 'resources', 'mochila.png'))
    tray = new Tray(icon.isEmpty() ? nativeImage.createFromPath(join(app.getAppPath(), 'resources', 'icon.png')) : icon.resize({ width: 24, height: 24 }))
    tray.setToolTip('Mochila · contexto en orden')
    tray.setContextMenu(Menu.buildFromTemplate([{ label: 'Abrir mochila', click: () => resize(true) }, { label: 'Pausar Ctrl+V', click: () => pause('Pausado desde la bandeja.') }, { label: 'Detener captura', click: () => capture(false) }, { type: 'separator' }, { label: 'Salir', click: () => app.quit() }]))
    tray.on('click', () => resize(true))
    powerMonitor.on('lock-screen', () => { capture(false); pause('Pausado al bloquear Windows.') })
    powerMonitor.on('suspend', () => { capture(false); pause('Pausado al suspender el equipo.') })
    // No startup registration, upstream updater, network feed, or initial capture.
  }).catch(e => { dialog.showErrorBox('Mochila', String(e)); app.quit() })
}
app.on('before-quit', () => { generation++; delivery.cancel(); capturing = false; watcher.stop(); paste?.stop(); psHost.dispose(); tray?.destroy() })
app.on('window-all-closed', () => app.quit())

// Retain the known upstream licence; files are never uploaded by this runtime.
