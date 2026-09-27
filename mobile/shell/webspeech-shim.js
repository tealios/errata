/*
 * Web Speech API shim for the Android shell.
 *
 * The Android System WebView ships no `speechSynthesis`, so Errata's "browser"
 * read-aloud engine has nothing to call. MainActivity exposes a native
 * `ErrataNativeTts` JS interface (android.speech.tts.TextToSpeech) and injects
 * this file at document start. It implements just enough of
 * `speechSynthesis` / `SpeechSynthesisUtterance` for src/lib/tts.ts: a FIFO
 * queue, start/end/error events, voices, cancel, and pause/resume (Android TTS
 * cannot pause, so pause stops and resume restarts the interrupted utterance;
 * utterances are sentence-sized chunks, so little is repeated).
 *
 * Native -> JS events arrive via window.__errataSpeech._native(type, id):
 *   'start' | 'end' | 'error' for an utterance id, 'voices' once the engine is up.
 *
 * Unit-tested in tests/android/webspeech-shim.test.ts.
 */
;(function (w) {
  var native = w.ErrataNativeTts
  if (!native || w.speechSynthesis) return

  function fire(target, type, extra) {
    var ev = new Event(type)
    if (extra) for (var k in extra) ev[k] = extra[k]
    var handler = target['on' + type]
    if (typeof handler === 'function') {
      try { handler.call(target, ev) } catch (e) { setTimeout(function () { throw e }) }
    }
    target.dispatchEvent(ev)
  }

  class SpeechSynthesisUtterance extends EventTarget {
    constructor(text) {
      super()
      this.text = text == null ? '' : String(text)
      this.lang = ''
      this.voice = null
      this.volume = 1
      this.rate = 1
      this.pitch = 1
      this.onstart = null
      this.onend = null
      this.onerror = null
      this.onpause = null
      this.onresume = null
      this.onboundary = null
      this.onmark = null
    }
  }

  var queue = []
  var current = null
  var currentId = null
  var paused = false
  var seq = 0
  var voiceCache = null

  var languageNames = null
  try {
    var uiLang = (w.navigator && w.navigator.language) || 'en'
    languageNames = new Intl.DisplayNames([uiLang], { type: 'language' })
  } catch (e) { languageNames = null }

  // Android names voices like "en-gb-x-gba-local" / "en-GB-language"; turn that into
  // "British English · gba" (+ "(online)" for network voices) for the voice picker.
  function voiceLabel(v) {
    var language = ''
    if (v.lang && languageNames) {
      try { language = languageNames.of(v.lang) || '' } catch (e) { language = '' }
    }
    if (!language) return v.name
    var m = /-x-([a-z0-9]+)-(?:local|network)$/i.exec(v.name)
    var label = m ? language + ' · ' + m[1] : language
    return v.local === false ? label + ' (online)' : label
  }

  function loadVoices() {
    var list = []
    try { list = JSON.parse(native.getVoices() || '[]') } catch (e) { list = [] }
    voiceCache = list.map(function (v) {
      return { voiceURI: v.name, name: voiceLabel(v), lang: v.lang || '', localService: v.local !== false, default: !!v.default }
    })
    return voiceCache
  }

  function send(u) {
    currentId = 'u' + ++seq
    var voice = u.voice && u.voice.voiceURI ? u.voice.voiceURI : ''
    native.speak(currentId, u.text, voice, Number(u.rate) || 1, Number(u.pitch) || 1, u.volume == null ? 1 : Number(u.volume))
  }

  function next() {
    if (paused || current || !queue.length) return
    current = queue.shift()
    send(current)
  }

  function finish(type, extra) {
    var u = current
    current = null
    currentId = null
    if (u) fire(u, type, extra)
    next()
  }

  class SpeechSynthesis extends EventTarget {
    constructor() {
      super()
      this.onvoiceschanged = null
    }
    get speaking() { return current !== null }
    get pending() { return queue.length > 0 }
    get paused() { return paused }
    getVoices() { return (voiceCache || loadVoices()).slice() }
    speak(u) {
      queue.push(u)
      next()
    }
    cancel() {
      var u = current
      queue.length = 0
      current = null
      currentId = null
      paused = false
      native.cancel()
      if (u) fire(u, 'error', { error: 'canceled', utterance: u })
    }
    pause() {
      if (paused) return
      paused = true
      if (current) {
        currentId = null // ignore the native stop callback for this speech
        native.cancel()
        fire(current, 'pause', { utterance: current })
      }
    }
    resume() {
      if (!paused) return
      paused = false
      if (current) {
        fire(current, 'resume', { utterance: current })
        send(current)
      } else {
        next()
      }
    }
    _native(type, id) {
      if (type === 'voices') {
        loadVoices()
        fire(this, 'voiceschanged')
        return
      }
      if (!id || id !== currentId || !current) return
      if (type === 'start') fire(current, 'start', { utterance: current, charIndex: 0 })
      else if (type === 'end') finish('end', { utterance: current, charIndex: current.text.length })
      else if (type === 'error') finish('error', { utterance: current, error: 'synthesis-failed' })
    }
  }

  var synth = new SpeechSynthesis()
  w.SpeechSynthesisUtterance = SpeechSynthesisUtterance
  w.speechSynthesis = synth
  w.__errataSpeech = synth
})(window)
