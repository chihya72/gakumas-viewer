/** Decode one ACB on demand; discard the worker and WAV after playback changes. */
export function decodeHomeVoice(buffer: ArrayBuffer, signal?: AbortSignal): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(`${import.meta.env.BASE_URL}home-voice-worker.js`)
    let settled = false
    const timeout = window.setTimeout(() => finish(new Error('音频解析超时，请重试')), 60000)
    const abort = () => finish(new DOMException('播放已取消', 'AbortError'))
    function finish(error?: Error, wav?: ArrayBuffer) {
      if (settled) return
      settled = true
      window.clearTimeout(timeout)
      signal?.removeEventListener('abort', abort)
      worker.terminate()
      if (error) reject(error)
      else resolve(new Blob([wav!], { type: 'audio/wav' }))
    }
    worker.onmessage = ({ data }) => {
      if (data.error) finish(new Error(data.error))
      else if (data.ready) worker.postMessage({ buffer }, [buffer])
      else if (data.buffer) finish(undefined, data.buffer)
    }
    worker.onerror = (event) => finish(new Error(event.message || 'vgmstream 加载失败'))
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) abort()
  })
}
