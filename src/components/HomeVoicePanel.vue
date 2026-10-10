<script setup lang="ts">
import { ref, shallowRef, computed, watch, onMounted, onBeforeUnmount, onDeactivated } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import PushHeader from './translate/push/PushHeader.vue'
import { store } from '../store'
import { decodeHomeVoice } from '../helper/home-voice-player'
import { WORK_OWNER, WORK_REPO, WORK_BRANCH } from '../helper/workflow'
import {
  remoteVoiceSource, parseVoices, previewEdit, homeVoiceStatus, escapeVoiceNewlines,
  completedVoiceEdit, saveGithubVoices, restoreVoiceDrafts,
  type HomeVoice, type VoiceEdits, type VoiceSource,
} from '../helper/home-voice'

const route = useRoute()
const router = useRouter()
const rows = shallowRef<HomeVoice[]>([])
const source = shallowRef<VoiceSource>()
const edits = shallowRef<VoiceEdits>({})
const selectedId = ref(String(route.query.id || ''))
const search = ref('')
const character = ref('')
const state = ref('all')
const page = ref(1)
const pageSize = 25
const busy = ref(false)
const error = ref('')
const notice = ref('')
const commitUrl = ref('')
const audio = ref<HTMLAudioElement>()
const audioUrl = ref('')
const decoding = ref(false)
let playbackEpoch = 0
let decodeController: AbortController | undefined

const selected = computed(() => rows.value.find((row) => row.voiceAssetId === selectedId.value))
const characters = computed(() => [...new Map(rows.value.map((row) => [row.characterCode, row.speaker])).entries()])
const visible = computed(() => {
  const query = search.value.trim().toLowerCase()
  return rows.value.filter((row) => {
    const effective = previewEdit(row, edits.value[row.voiceAssetId])
    return (!character.value || row.characterCode === character.value) &&
      (!query || [row.voiceAssetId, row.speaker, effective.ja, effective.zh].join(' ').toLowerCase().includes(query)) &&
      (state.value === 'all' || state.value === homeVoiceStatus(row))
  })
})
const pageCount = computed(() => Math.max(1, Math.ceil(visible.value.length / pageSize)))
const paged = computed(() => visible.value.slice((Math.min(page.value, pageCount.value) - 1) * pageSize, Math.min(page.value, pageCount.value) * pageSize))
const currentEdit = computed(() => selected.value && edits.value[selected.value.voiceAssetId])
const jaText = computed({ get: () => currentEdit.value?.ja ?? selected.value?.ja ?? '', set: (value: string) => updateEdit({ ja: value }) })
const zhText = computed({ get: () => currentEdit.value?.zh ?? selected.value?.zh ?? '', set: (value: string) => updateEdit({ zh: value }) })

function cacheDrafts() {
  if (!source.value) return
  try { localStorage.setItem(`home-voice-drafts:${source.value.key}`, JSON.stringify(edits.value)) }
  catch { error.value = '浏览器草稿保存失败，请完成校对或复制当前修改内容后再关闭页面。' }
}
function updateEdit(patch: Partial<VoiceEdits[string]>) {
  const row = selected.value
  if (!row) return
  const current = edits.value[row.voiceAssetId] || { baseJa: row.ja, baseZh: row.zh, ja: row.ja, zh: row.zh }
  edits.value = { ...edits.value, [row.voiceAssetId]: { ...current, ...patch } }
  cacheDrafts()
  notice.value = '已自动保存到浏览器草稿'
}
function resetFilters() { page.value = 1 }
function stopAudio() {
  playbackEpoch++
  decodeController?.abort()
  audio.value?.pause()
  audio.value?.removeAttribute('src')
  audio.value?.load()
  if (audioUrl.value) URL.revokeObjectURL(audioUrl.value)
  audioUrl.value = ''
  decoding.value = false
}
function select(row: HomeVoice) {
  stopAudio()
  selectedId.value = row.voiceAssetId
  router.replace({ path: '/home-voice', query: { id: row.voiceAssetId } })
}
watch(() => route.query.id, (id) => {
  if (route.path === '/home-voice' && id && String(id) !== selectedId.value) {
    stopAudio()
    selectedId.value = String(id)
  }
})
async function openSource(next: VoiceSource) {
  busy.value = true; error.value = ''; notice.value = ''; commitUrl.value = ''
  try {
    const loaded = await next.load()
    stopAudio()
    rows.value = loaded; source.value = next; page.value = 1
    edits.value = restoreVoiceDrafts(next, localStorage,
      next.directory === 'home-voice' && next.key.startsWith('github:')
        ? 'github:chihya72/Gakumas-Home-Voice-Translate/main' : undefined)
    if (!loaded.some((row) => row.voiceAssetId === selectedId.value)) selectedId.value = loaded[0]?.voiceAssetId || ''
    notice.value = `已读取 ${loaded.length} 条语音；点击播放时解析 ACB。`
  } catch (e: any) { error.value = e.message || String(e) }
  finally { busy.value = false }
}
async function play() {
  if (!selected.value || !source.value) return
  stopAudio()
  const epoch = playbackEpoch
  decodeController = new AbortController()
  decoding.value = true; error.value = ''
  try {
    const buffer = await source.value.audio(selected.value)
    if (epoch !== playbackEpoch) return
    const blob = await decodeHomeVoice(buffer, decodeController.signal)
    if (epoch !== playbackEpoch) return
    audioUrl.value = URL.createObjectURL(blob)
    if (audio.value) {
      audio.value.src = audioUrl.value
      await audio.value.play()
    }
  } catch (e: any) {
    if (e.name !== 'AbortError' && epoch === playbackEpoch) error.value = e.message || String(e)
  } finally { if (epoch === playbackEpoch) decoding.value = false }
}
async function completeReview() {
  const row = selected.value
  if (!source.value || !row || busy.value) return
  busy.value = true; error.value = ''; notice.value = ''
  try {
    const edit = completedVoiceEdit(row, edits.value[row.voiceAssetId])
    const result = await saveGithubVoices(source.value, { [row.voiceAssetId]: edit }, store.octokitWrapper)
    rows.value = result.rows; commitUrl.value = result.url
    const remaining = { ...edits.value }
    delete remaining[row.voiceAssetId]
    edits.value = remaining; cacheDrafts()
    notice.value = '本条语音已完成校对，日中内容和已校对状态已保存到 GitHub。'
  } catch (e: any) { error.value = e.message || String(e) }
  finally { busy.value = false }
}
onMounted(async () => {
  const next = remoteVoiceSource(WORK_OWNER, WORK_REPO, WORK_BRANCH, 'home-voice')
  if (import.meta.env.DEV && import.meta.env.VITE_HOME_VOICE_LOCAL_PREVIEW === '1') {
    // Explicit development fixture only; published builds always use the fixed GitHub source.
    const base = '/home-voice-local/'
    async function request(path: string) {
      const response = await fetch(base + path, { cache: 'no-store' })
      if (!response.ok) throw new Error('开发预览数据不可用')
      return response
    }
    await openSource({ ...next, key: 'dev:home-voice',
      load: async () => parseVoices(await (await request('data/voices.json')).json()),
      ui: async () => (await request('data/subtitle_ui.json')).json(),
      audio: async (row) => (await request(row.acb.replace(/\\/g, '/'))).arrayBuffer(),
    })
  } else {
    await openSource(next)
  }
})
onDeactivated(stopAudio)
onBeforeUnmount(stopAudio)
</script>

<template>
  <section class="voice-page">
    <push-header title="主页语音校对" />
    <p v-if="error" role="alert" class="error">{{ error }}</p>
    <p v-if="notice" role="status" class="notice">{{ notice }} <a v-if="commitUrl" :href="commitUrl" target="_blank" rel="noopener">查看提交</a></p>
    <div v-if="rows.length" class="workspace">
      <aside class="voice-list">
        <div class="filters">
          <label>搜索 ID 或台词<input v-model="search" type="search" @input="resetFilters" /></label>
          <div class="filter-row">
            <label>角色<select v-model="character" @change="resetFilters"><option value="">全部角色</option><option v-for="[code, name] in characters" :key="code" :value="code">{{ name || code }}</option></select></label>
            <label>状态<select v-model="state" @change="resetFilters"><option value="all">全部</option><option value="ai_review">AI识别待复核</option><option value="pending">待校对</option><option value="reviewed">已校对</option></select></label>
          </div>
          <span class="hint">匹配 {{ visible.length }} / {{ rows.length }} 条</span>
        </div>
        <div class="list-items" aria-label="语音列表">
          <button v-for="row in paged" :key="row.voiceAssetId" :class="{ active: row.voiceAssetId === selectedId }" :aria-pressed="row.voiceAssetId === selectedId" @click="select(row)">
            <span class="row-heading">{{ row.speaker }} <small>{{ homeVoiceStatus(row) === 'reviewed' ? '已校对' : homeVoiceStatus(row) === 'ai_review' ? 'AI识别待复核' : '待校对' }}</small></span>
            <span class="voice-id">{{ row.voiceAssetId }}</span>
            <span class="preview">{{ previewEdit(row, edits[row.voiceAssetId]).ja || '待识别' }}</span>
          </button>
        </div>
        <div class="pagination"><button :disabled="page <= 1" @click="page--">上一页</button><span>{{ Math.min(page, pageCount) }} / {{ pageCount }}</span><button :disabled="page >= pageCount" @click="page++">下一页</button></div>
      </aside>
      <article v-if="selected" class="editor">
        <div class="editor-title"><h2>{{ selected.speaker }} <span>语音校对</span></h2></div>
        <p class="voice-id selected-id">{{ selected.voiceAssetId }}</p>
        <div class="player">
          <button class="primary" :disabled="decoding" @click="play">{{ decoding ? '解析 ACB…' : '播放 / 重播' }}</button>
          <button :disabled="!audioUrl && !decoding" @click="stopAudio">停止</button>
          <audio ref="audio" controls preload="none" aria-label="主页语音播放器" />
        </div>
        <p v-if="selected.asr_error || selected.asr_review?.length" class="hint">识别提示：{{ selected.asr_error || selected.asr_review?.join('、') }}</p>
        <label class="text-field">日语 · OpenMOSS 转写<textarea v-model="jaText" :disabled="busy" lang="ja" rows="6" spellcheck="false" /></label>
        <label class="text-field">简体中文 · 机翻与校对<textarea v-model="zhText" :disabled="busy" lang="zh-CN" rows="6" spellcheck="false" /></label>
        <details class="original"><summary>查看本次载入的原稿</summary><p lang="ja">{{ escapeVoiceNewlines(selected.ja) }}</p><p lang="zh-CN">{{ escapeVoiceNewlines(selected.zh) }}</p></details>
        <div class="actions">
          <button class="primary" :disabled="busy" @click="completeReview">{{ busy ? '保存中…' : '完成校对' }}</button>
        </div>
        <p class="hint">编辑自动暂存；点击“完成校对”将本条日中内容保存到 GitHub，并标记为已校对。</p>
      </article>
    </div>
    <div v-else-if="!busy" class="empty">暂未读取到主页语音数据。</div>
    <p v-if="busy && !rows.length" role="status">正在读取语音总表…</p>
  </section>
</template>

<style scoped>
.voice-page { --voice-ink: #0f172a; --voice-muted: #475569; --voice-border: #cbd5e1; --voice-primary: #075985; color: var(--voice-ink); }
.filter-row, .pagination, .editor-title, .player, .actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
button, input, select, textarea { font: inherit; }
button { min-height: 44px; border: 1px solid var(--voice-border); border-radius: 6px; padding: 8px 12px; background: #fff; color: var(--voice-ink); cursor: pointer; }
button:hover { background: #f0f9ff; }
button:disabled { opacity: .55; cursor: default; }
button.primary { color: #fff; background: var(--voice-primary); border-color: var(--voice-primary); }
button:focus-visible, input:focus-visible, textarea:focus-visible, select:focus-visible, summary:focus-visible { outline: 3px solid #0284c7; outline-offset: 2px; }
label { display: flex; flex-direction: column; gap: 6px; font-size: 14px; }
input, select, textarea { width: 100%; box-sizing: border-box; padding: 10px; border: 1px solid var(--voice-border); border-radius: 6px; color: var(--voice-ink); background: #fff; min-height: 44px; }
summary { cursor: pointer; min-height: 44px; line-height: 44px; }
.hint { color: var(--voice-muted); font-size: 13px; line-height: 1.6; }
.error, .notice { padding: 12px; border-radius: 6px; overflow-wrap: anywhere; }
.error { color: #991b1b; background: #fef2f2; }
.notice { color: #075985; background: #f0f9ff; }
.workspace { display: grid; grid-template-columns: 340px minmax(0, 1fr); gap: 16px; align-items: stretch; margin-top: 16px; }
.voice-list, .editor { min-width: 0; box-sizing: border-box; background: #fff; border: 1px solid var(--voice-border); border-radius: 8px; }
.voice-list { display: flex; flex-direction: column; }
.filters { display: grid; gap: 12px; padding: 16px; border-bottom: 1px solid var(--voice-border); }
.filter-row label { flex: 1; min-width: 0; }
.list-items { max-height: 590px; min-width: 0; overflow-y: auto; overflow-x: hidden; }
.list-items button { display: grid; grid-template-columns: minmax(0, 1fr); gap: 6px; width: 100%; min-width: 0; box-sizing: border-box; margin: 0; text-align: left; border: 0; border-bottom: 1px solid #e2e8f0; border-radius: 0; padding: 12px 16px; }
.list-items button.active { background: #e0f2fe; box-shadow: inset 3px 0 var(--voice-primary); }
.row-heading { font-weight: 600; }
.row-heading small { margin-left: 8px; font-weight: 400; color: var(--voice-primary); }
.voice-id { font-family: monospace; font-size: 12px; overflow-wrap: anywhere; color: var(--voice-muted); }
.preview { min-width: 0; font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pagination { margin-top: auto; padding: 12px; justify-content: space-between; font-size: 13px; }
.editor { display: flex; flex-direction: column; padding: 20px; }
.editor-title { justify-content: space-between; }
h2 { margin: 0; font-size: 22px; }
h2 span { font-size: 14px; font-weight: 400; color: var(--voice-muted); }
.selected-id { margin: 8px 0 16px; }
.player { margin-bottom: 20px; }
audio { flex: 1; min-width: 200px; width: 100%; height: 44px; }
.text-field { margin: 16px 0; font-weight: 600; }
textarea { font-size: 16px; font-weight: 400; line-height: 1.75; resize: vertical; }
.original { margin-bottom: 16px; }
.original p { white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.75; }
.actions { border-top: 1px solid var(--voice-border); padding-top: 16px; margin-top: auto; }
.empty { padding: 40px 24px; text-align: center; border: 1px dashed var(--voice-border); border-radius: 8px; line-height: 1.8; }
@media (max-width: 800px) { .workspace { grid-template-columns: 1fr; } .list-items { max-height: 260px; } .editor { padding: 16px; } label { font-size: 16px; } }
</style>
