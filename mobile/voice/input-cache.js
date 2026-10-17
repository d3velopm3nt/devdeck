const dbPromise = new Promise((resolve, reject) => {
  const request = indexedDB.open('devdeck-local-input-v1', 1);
  request.onupgradeneeded = () => request.result.createObjectStore('files');
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(new Error('Local microphone storage is unavailable.'));
});
export async function stored(key, value) {
  const db = await dbPromise;
  return new Promise((resolve, reject) => {
    const writing = value !== undefined;
    const tx = db.transaction('files', writing ? 'readwrite' : 'readonly');
    const request = writing ? tx.objectStore('files').put(value, key) : tx.objectStore('files').get(key);
    let result;
    request.onsuccess = () => { result = request.result; };
    tx.oncomplete = () => resolve(result);
    tx.onerror = tx.onabort = () => reject(new Error('Could not save microphone model. Check available disk space.'));
  });
}
export const cache = {
  failed: false,
  async match(url) {
    const value = await stored(String(url));
    return value ? new Response(value.body, { status: 200, headers: value.headers }) : undefined;
  },
  async put(url, response) {
    if (!response.ok) throw new Error('Microphone model download failed.');
    try { await stored(String(url), { body: await response.arrayBuffer(), headers: [...response.headers] }); }
    catch (error) { cache.failed = true; throw error; }
  },
};
