/** Own compiled renderer + real preload in a hidden offscreen Electron window.
 * The backend is explicitly simulated; no OS clipboard or keyboard hook is used.
 */
const { app, BrowserWindow, ipcMain } = require('electron')
const { join, resolve } = require('node:path')
const { mkdirSync, writeFileSync } = require('node:fs')
const assert = require('node:assert/strict')
const root = resolve(__dirname, '..')
const output = join(root, 'mochila-docs', 'pc-002-evidence')
const testData = join(root, 'scratch', 'mochila-renderer-check')
mkdirSync(output, { recursive: true }); mkdirSync(testData, { recursive: true })
app.setPath('userData', testData); app.disableHardwareAcceleration()
let window
let state = { schema: 1, queue: [], history: [], capturing: false, armed: false, busy: false, limit: null, remaining: null, error: null, expanded: false, nativeReady: true, targetLocked: false }
const commands = []
const warnings = []
const checks = []
const sleep = ms => new Promise(done => setTimeout(done, ms))
async function js(source) { return window.webContents.executeJavaScript(source) }
async function until(source) { for (let i = 0; i < 100; i++) { if (await js(source)) return; await sleep(50) } throw new Error('Timeout: ' + source) }
function push() { window.webContents.send('mochila:state', state) }
async function shot(name) { await sleep(550); writeFileSync(join(output, name + '.png'), (await window.webContents.capturePage()).toPNG()) }
const deadline = setTimeout(() => { writeFileSync(join(output, 'renderer-check.json'), JSON.stringify({ status: 'FAIL', error: 'Timeout', checks, warnings })); app.exit(2) }, 45000)
app.whenReady().then(async () => {
  window = new BrowserWindow({ width: 192, height: 252, frame: false, transparent: true, show: false, webPreferences: { preload: join(root, 'out/preload/index.cjs'), offscreen: true, contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false } })
  window.webContents.session.webRequest.onBeforeRequest((details, cb) => cb({ cancel: !details.url.startsWith('file:') && !details.url.startsWith('data:') }))
  window.webContents.on('console-message', (_event, level, message) => { if (level >= 2) warnings.push(message) })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  ipcMain.handle('mochila:load', () => state)
  ipcMain.handle('mochila:preview', () => null)
  ipcMain.handle('mochila:files', () => { throw new Error('Native Explorer file drops are outside this simulated backend') })
  ipcMain.handle('mochila:command', (_event, c) => {
    commands.push(c)
    if (c.type === 'zipper') {
      if (state.capturing) { state.capturing = false; state.armed = state.queue.length > 0; state.remaining = c.limit }
      else { state.capturing = true; state.armed = false }
    } else if (c.type === 'drop-text') {
      state.capturing = true; state.armed = false
      state.queue.push({ id: 'synthetic-' + state.queue.length, title: c.text, payload: { kind: 'text', text: c.text }, createdAt: new Date().toISOString(), source: 'drop', bytes: Buffer.byteLength(c.text) })
    } else if (c.type === 'expand') { state.expanded = c.expanded; window.setSize(c.expanded ? 430 : 192, c.expanded ? 680 : 252) }
    else if (c.type === 'pause') state.armed = false
    push(); return state
  })
  await window.loadFile(join(root, 'out/renderer/mochila.html'))
  await until('!!document.querySelector(".collapsed")')
  assert.equal(await js('document.querySelector(".mochila-shell") === null'), true)
  checks.push('Starts as a collapsed pet with capture and paste paused')
  window.webContents.sendInputEvent({ type: 'mouseMove', x: 90, y: 85 })
  await sleep(120)
  assert.equal(commands.filter(c => c.type === 'expand').length, 0)
  checks.push('Real renderer mouse hover does not request panel expansion')
  await js('document.querySelector(".pet-button").click()')
  await until('document.querySelector(".collapsed.collecting") !== null')
  assert.equal(state.capturing, true); assert.equal(state.expanded, false)
  await shot('minimizada-abierta')
  checks.push('Clicking the zipper opens collection without showing the panel')
  await js(`(() => { const transfer = new DataTransfer(); transfer.setData('text/plain', 'TEXTO DE PRUEBA · captura 1'); document.querySelector('.collapsed').dispatchEvent(new DragEvent('dragenter', { bubbles: true, dataTransfer: transfer })); document.querySelector('.collapsed').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer })); })()`)
  await until('document.querySelector(".pet-counter").textContent === "1"')
  assert.equal(state.queue[0].payload.text, 'TEXTO DE PRUEBA · captura 1')
  assert.equal(state.expanded, false)
  checks.push('Dropped text crosses the actual preload/IPC boundary without expanding')
  await js('document.querySelector(".pet-button").click()')
  await until('document.querySelector(".collapsed.delivering") !== null')
  assert.equal(state.armed, true); assert.equal(state.capturing, false)
  await shot('minimizada-cerrada')
  checks.push('Closing the zipper displays Ctrl+V ready in collapsed mode')
  await js(`(() => { const transfer = new DataTransfer(); transfer.setData('text/plain', 'TEXTO DE PRUEBA · PDF'); document.querySelector('.collapsed').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer })); })()`)
  await until('document.querySelector(".pet-counter").textContent === "2"')
  assert.equal(state.armed, false); assert.equal(state.capturing, true); assert.equal(state.expanded, false)
  checks.push('A new drop returns from delivery to collection without showing the panel')
  await js(`document.querySelector('button[aria-label="Ver cola e historial"]').click()`)
  await until('document.querySelector(".mochila-shell") !== null')
  await shot('panel')
  const geometry = await js(`(() => { const shell = document.querySelector('.mochila-shell'); return { width: innerWidth, height: innerHeight, shellHeight: shell.clientHeight, scrollHeight: shell.scrollHeight, entries: document.querySelectorAll('.queue-entry').length } })()`)
  assert.equal(geometry.entries, 2); assert.equal(geometry.scrollHeight, geometry.shellHeight)
  checks.push('The separate panel button expands to a non-overflowing two-entry queue')
  await js(`document.querySelector('button[aria-label="Ocultar panel"]').click()`)
  await until('document.querySelector(".collapsed") !== null')
  const compact = await js('({ height: innerHeight, scroll: document.querySelector(".collapsed").scrollHeight, width: innerWidth })')
  assert.ok(compact.scroll <= compact.height)
  checks.push('Returning to the compact pet fits the 192×252 window')
  assert.deepEqual(warnings, [])
  const result = { status: 'PASS', checks, warnings, geometry, compact, backend: 'SIMULATED', real_preload: true, operating_system_clipboard: 'NOT USED', native_explorer_drop: 'NO VERIFICADO', live_keyboard_hook: 'NOT USED', method: 'Electron hidden offscreen BrowserWindow', docs: 'https://www.electronjs.org/docs/latest/tutorial/offscreen-rendering' }
  writeFileSync(join(output, 'renderer-check.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result)); clearTimeout(deadline); app.exit(0)
}).catch(error => { writeFileSync(join(output, 'renderer-check.json'), JSON.stringify({ status: 'FAIL', error: String(error), stack: error.stack, checks, warnings }, null, 2)); console.error(error); clearTimeout(deadline); app.exit(1) })
