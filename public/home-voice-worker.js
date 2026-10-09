/* vgmstream WASM runs in this worker; input and decoded PCM stay in memory. */
let output = ''
let errors = ''
let readyResolve, readyReject
const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject })
var Module = {
  noInitialRun: true,
  noExitRuntime: true,
  locateFile: (name) => new URL(name, self.location.href).href,
  print: (text) => { output += text + '\n' },
  printErr: (text) => { errors += text + '\n' },
  onRuntimeInitialized: () => readyResolve(),
  onAbort: (reason) => readyReject(new Error(String(reason))),
}
try { importScripts('vgmstream-cli.js') } catch (error) { readyReject(error) }
// Report readiness separately so startup failures cannot leave a playback pending.
ready.then(() => postMessage({ ready: true }), (error) => postMessage({ error: error.message }))
onmessage = async ({ data }) => {
  try {
    await ready
    output = ''; errors = ''
    FS.writeFile('/voice.acb', new Uint8Array(data.buffer))
    const code = callMain(['-i', '-o', '/voice.wav', '/voice.acb'])
    if (code !== 0) throw new Error(errors.trim() || `vgmstream 解析失败：${code}`)
    const wav = FS.readFile('/voice.wav').slice()
    if (wav.length < 44) throw new Error('ACB 没有可播放的音频')
    postMessage({ buffer: wav.buffer, info: output }, [wav.buffer])
  } catch (error) {
    postMessage({ error: error.message || String(error) })
  } finally {
    for (const path of ['/voice.acb', '/voice.wav']) {
      try { FS.unlink(path) } catch { /* output may not exist after a decode error */ }
    }
  }
}
