/// <reference lib="dom" />
import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { MochilaApi, MochilaCommand, MochilaView } from '../../shared/mochila'
const api: MochilaApi = {
  load: () => ipcRenderer.invoke('mochila:load'),
  command: (command: MochilaCommand) => ipcRenderer.invoke('mochila:command', command),
  dropFiles: (paths: string[]) => ipcRenderer.invoke('mochila:files', paths),
  preview: (id: string) => ipcRenderer.invoke('mochila:preview', id),
  movePet: phase => ipcRenderer.invoke('mochila:move', phase),
  onState: callback => {
    const handler = (_: unknown, state: MochilaView) => callback(state)
    ipcRenderer.on('mochila:state', handler)
    return () => { ipcRenderer.removeListener('mochila:state', handler) }
  }
}
contextBridge.exposeInMainWorld('mochila', api)
window.addEventListener('dragover', e => e.preventDefault())
window.addEventListener('drop', e => {
  e.preventDefault()
  const files = Array.from(e.dataTransfer?.files ?? [])
  const paths = files.map(file => webUtils.getPathForFile(file)).filter(Boolean)
  if (paths.length) void api.dropFiles(paths)
  else {
    const text = e.dataTransfer?.getData('text/plain')
    if (text) void api.command({ type: 'drop-text', text })
  }
})
