// Runs on the audio thread. Collects mono samples into 1,024-sample frames (about 43 ms at 24 kHz)
// and posts each as 16-bit little-endian PCM. Nothing is stored or played back.
class PcmCapture extends AudioWorkletProcessor {
  constructor() {
    super()
    this.buf = new Float32Array(1024)
    this.n = 0
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0]
    if (!ch) return true
    for (let i = 0; i < ch.length; i++) {
      this.buf[this.n++] = ch[i]
      if (this.n === this.buf.length) {
        const out = new Int16Array(this.buf.length)
        for (let j = 0; j < out.length; j++) {
          const v = Math.max(-1, Math.min(1, this.buf[j]))
          out[j] = v < 0 ? v * 0x8000 : v * 0x7fff
        }
        this.port.postMessage(out.buffer, [out.buffer])
        this.n = 0
      }
    }
    return true
  }
}
registerProcessor('pcm-capture', PcmCapture)
