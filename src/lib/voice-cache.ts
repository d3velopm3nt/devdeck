/** Read only saved readiness markers; model workers verify files when loading. */
async function saved(name: string): Promise<boolean> {
  return new Promise(resolve => {
    const request = indexedDB.open(name, 1)
    request.onupgradeneeded = () => request.result.createObjectStore('files')
    request.onerror = () => resolve(false)
    request.onsuccess = () => {
      const db = request.result
      const tx = db.transaction('files', 'readonly')
      const value = tx.objectStore('files').get('ready')
      value.onsuccess = () => resolve(value.result === true)
      value.onerror = () => resolve(false)
      tx.oncomplete = tx.onabort = () => db.close()
    }
  })
}
export async function savedVoiceModels() {
  const [microphone, speaker] = await Promise.all([saved('devdeck-local-input-v1'), saved('devdeck-local-voice-v1')])
  return { microphone, speaker }
}
