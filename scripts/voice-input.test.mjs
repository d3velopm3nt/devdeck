import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import assert from 'node:assert/strict'
import { test } from 'node:test'

const source = readFileSync(new URL('../src/lib/voice-input.js', import.meta.url), 'utf8')
function fixture(extras = {}) {
  let now = 0, next = 0, recognition
  const timers = new Map(), sent = [], errors = []
  const context = vm.createContext({ navigator: { language: 'en-ZA' },
    setTimeout(fn, delay) { const id = ++next; timers.set(id, { fn, at: now + delay }); return id },
    clearTimeout(id) { timers.delete(id) },
    ...extras,
  })
  vm.runInContext(source, context)
  class Recognition {
    starts = 0
    constructor() { recognition = this }
    start() { this.starts++; this.onstart?.() }
    stop() { this.onend?.() }
    abort() { this.onend?.() }
  }
  const input = context.DevVoiceInput.create({ Recognition,
    onState() {}, onCaption() {}, onText(text) { sent.push(text) }, onError(error) { errors.push(error) },
  })
  input.start()
  return { input, sent, errors, get recognition() { return recognition },
    result(text, final = true) { recognition.onresult({ results: [Object.assign([{ transcript: text }], { isFinal: final })] }) },
    tick(ms) {
      const end = now + ms
      for (;;) {
        const earliest = [...timers].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0]
        if (!earliest) break
        timers.delete(earliest[0]); now = earliest[1].at; earliest[1].fn()
      }
      now = end
    },
  }
}
test('a thinking pause waits 3.2 seconds and new words reset the window', () => {
  const f = fixture(); f.result('Let me think'); f.tick(2500)
  assert.deepEqual(f.sent, []); assert.equal(f.input.state(), 'listening')
  f.result('Let me think about the next task'); f.tick(3199); assert.deepEqual(f.sent, [])
  f.tick(1); assert.deepEqual(f.sent, ['Let me think about the next task'])
})
test('browser end resumes capture and joins the continuation into one message', () => {
  const f = fixture(); f.result('First thought'); f.tick(500); f.recognition.onend()
  assert.equal(f.recognition.starts, 2); assert.deepEqual(f.sent, [])
  f.tick(1500); f.result('and a continuation', false); f.tick(3200)
  assert.deepEqual(f.sent, ['First thought and a continuation']); assert.deepEqual(f.errors, [])
})
test('manual finish submits immediately and ignores late browser callbacks', () => {
  const f = fixture(); f.result('Done talking'); f.input.finish(); f.recognition.onend(); f.tick(10000)
  assert.deepEqual(f.sent, ['Done talking'])
})
test('cancel discards buffered speech and never restarts capture', () => {
  const f = fixture(); f.result('Discard this'); f.input.cancel(); f.recognition.onend(); f.tick(10000)
  assert.deepEqual(f.sent, []); assert.equal(f.recognition.starts, 1)
})
test('no-speech after a transcript waits, and a missing end still delivers once', () => {
  const f = fixture(); f.result('Android interim', false)
  f.recognition.onerror({ error: 'no-speech' }); f.tick(3199); assert.deepEqual(f.sent, [])
  f.recognition.stop = () => {}; f.tick(1); assert.deepEqual(f.sent, [])
  f.tick(700); assert.deepEqual(f.sent, ['Android interim'])
})
test('microphone level follows audio and stops its stream on finish', async () => {
  let amplitude = 0, stopped = 0, closed = 0
  const stream = { getTracks: () => [{ stop() { stopped++ } }] }
  class AudioContext {
    createAnalyser() { return { fftSize: 512, disconnect() {}, getByteTimeDomainData(samples) { samples.fill(128 + amplitude) } } }
    createMediaStreamSource() { return { connect() {}, disconnect() {} } }
    async resume() {}
    async close() { closed++ }
  }
  const f = fixture({ AudioContext, navigator: { language: 'en-ZA', mediaDevices: { async getUserMedia() { return stream } } } })
  await new Promise(setImmediate)
  assert.equal(f.input.level(), 0)
  amplitude = 30; assert.ok(f.input.level() > .3)
  amplitude = 0; const first = f.input.level(); assert.ok(f.input.level() < first)
  f.result('Finish'); f.input.finish()
  assert.equal(f.input.level(), 0); assert.equal(stopped, 1); assert.equal(closed, 1)
})
test('a late microphone permission result after cancel stops the new stream', async () => {
  let resolveStream, stopped = 0
  const f = fixture({ AudioContext: class {}, navigator: { language: 'en-ZA', mediaDevices: { getUserMedia() { return new Promise(resolve => { resolveStream = resolve }) } } } })
  f.input.cancel(); resolveStream({ getTracks: () => [{ stop() { stopped++ } }] })
  await new Promise(setImmediate); assert.equal(stopped, 1); assert.equal(f.input.level(), 0)
})

test('Android growing hypotheses at separate indices produce one sentence', () => {
  const f = fixture()
  const words = ['okay', 'okay but', "okay but why", "okay but why can't you pick up my voice"]
  f.recognition.onresult({ results: words.map(text => Object.assign([{ transcript: text }], { isFinal: true })) })
  f.tick(3200)
  assert.deepEqual(f.sent, [words.at(-1)])
})
test('genuine repeated words and independent segments are preserved', () => {
  const f = fixture()
  f.recognition.onresult({ results: ['very very good', 'yes', 'yes'].map(text => Object.assign([{ transcript: text }], { isFinal: true })) })
  f.input.finish()
  assert.deepEqual(f.sent, ['very very good yes yes'])
})

test('a genuine final prefix pair is not erased', () => {
  const f = fixture()
  f.recognition.onresult({ results: ['yes', 'yes please'].map(text => Object.assign([{ transcript: text }], { isFinal: true })) })
  f.input.finish()
  assert.deepEqual(f.sent, ['yes yes please'])
})
test('prefix extensions across browser restarts remain distinct speech', () => {
  const f = fixture()
  for (const text of ['go', 'go now', 'go now please']) {
    f.result(text)
    f.recognition.onend()
  }
  f.input.finish()
  assert.deepEqual(f.sent, ['go go now go now please'])
})

test('failed acknowledgement synthesis falls back once, cancellation stays silent', async () => {
  const voiceSource = readFileSync(new URL('../mobile/voice-client.js', import.meta.url), 'utf8')
  let worker, activeId
  class Worker {
    constructor() { worker = this }
    postMessage(data) { if (data.type === 'speak') activeId = data.id }
  }
  class AudioContext {
    async resume() {}
    createAnalyser() { return { connect() {}, fftSize: 256 } }
  }
  const context = vm.createContext({ Worker, window: { AudioContext }, Uint8Array })
  vm.runInContext(voiceSource, context)
  const button = {}, status = {}, idle = () => {}
  const voice = context.createOfflineVoice({ button, status, onSpeaking: idle, onIdle: idle, onChange: idle })
  button.onclick(); worker.onmessage({ data: { type: 'ready' } })
  let fallbacks = 0
  await voice.speak('Got it.', () => fallbacks++)
  worker.onmessage({ data: { type: 'error', id: activeId, message: 'Synthesis failed' } })
  worker.onmessage({ data: { type: 'error', id: activeId, message: 'Duplicate failure' } })
  assert.equal(fallbacks, 1)
  worker.onmessage({ data: { type: 'ready' } })
  await voice.speak('Got it.', () => fallbacks++)
  voice.stop()
  worker.onmessage({ data: { type: 'error', id: activeId, message: 'Cancelled request' } })
  assert.equal(fallbacks, 1)
  assert.equal(voice.canSpeak(), true, 'Cancelled synthesis errors release the voice for the next request')
})
