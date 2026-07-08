<!-- 汉化工作台：全文档总览。一行一剧情，翻译/校对两条独立轨道，各自显示认领人+状态、可各自认领。
     "完成"在编辑器里点，不在这里。 -->
<template>
  <div class="workbench">
    <push-header title="汉化工作台" />
    <div class="build-mark">构建标记 B18（若看不到此行=仍是旧缓存）</div>

    <div v-if="!store.octokitWrapper?.userMeta" class="hint">
      请先登录 GitHub 账号（需已加入工作组，即对工作仓库有写权限）。
    </div>

    <template v-else>
      <div class="toolbar">
        <n-button size="small" :loading="loading" @click="refresh"
          >刷新</n-button
        >
        <span class="me">我：{{ displayUser(me) }}</span>
        <n-checkbox v-model:checked="onlyMine">只看我的</n-checkbox>
        <template v-if="selected.size">
          <n-button
            size="small"
            type="info"
            :loading="batchBusy"
            @click="batchClaim('tr')"
          >
            批量认领翻译({{ selected.size }})
          </n-button>
          <n-button
            size="small"
            type="info"
            :loading="batchBusy"
            @click="batchClaim('pr')"
          >
            批量认领校对({{ selected.size }})
          </n-button>
        </template>
      </div>

      <n-alert v-if="error" type="error" :bordered="false">{{ error }}</n-alert>

      <table v-if="rows.length" class="grid">
        <thead>
          <tr>
            <th class="sel-col">
              <n-checkbox
                :checked="allSelected"
                @update:checked="toggleAll"
              />
            </th>
            <th>剧情</th>
            <th>翻译</th>
            <th>校对</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="d in rows" :key="d.number" :class="{ mine: isMine(d) }">
            <td class="sel-col">
              <n-checkbox
                :checked="selected.has(d.number)"
                @update:checked="(v: boolean) => toggleSel(d.number, v)"
              />
            </td>
            <td class="doc">
              <a href="javascript:;" @click="open(d)">{{ d.title }}</a>
            </td>
            <!-- 翻译轨：第一行=状态+时间，第二行=功能按钮 -->
            <td>
              <div class="cell-col">
                <div class="cell-line">
                  <n-tag
                    size="small"
                    :type="tagType(d.tr.state)"
                    :bordered="false"
                  >
                    {{ trackLabel(d.tr) }}
                  </n-tag>
                  <span v-if="d.trCsvTime" class="time">{{
                    formatGmt8(d.trCsvTime)
                  }}</span>
                </div>
                <div class="cell-line">
                  <n-button
                    size="tiny"
                    @click="downloadCsvPath(d.aiPath, d.title, 'AI机翻')"
                  >
                    下载AI机翻CSV
                  </n-button>
                  <n-button
                    v-if="d.tr.state === '待认领'"
                    size="tiny"
                    type="info"
                    :loading="busy === d.number"
                    @click="claim(d, 'tr')"
                  >
                    认领
                  </n-button>
                  <n-button
                    v-if="d.tr.state === '待认领'"
                    size="tiny"
                    type="warning"
                    :loading="busy === d.number"
                    @click="aiComplete(d)"
                  >
                    一键完成翻译
                  </n-button>
                  <n-button
                    v-if="d.tr.user === me && d.tr.state === '进行中'"
                    size="tiny"
                    type="primary"
                    @click="open(d, 'tr')"
                  >
                    开始在线翻译
                  </n-button>
                  <n-button
                    v-if="d.tr.state === '完成'"
                    size="tiny"
                    @click="open(d, 'tr')"
                  >
                    重新翻译
                  </n-button>
                </div>
              </div>
            </td>
            <!-- 校对轨：可随时认领；翻译未完成时不能开始校对 -->
            <td>
              <div class="cell-col">
                <div class="cell-line">
                  <n-tag
                    size="small"
                    :type="
                      d.tr.state === '完成' ? tagType(d.pr.state) : 'default'
                    "
                    :bordered="false"
                  >
                    {{ prCellLabel(d) }}
                  </n-tag>
                  <span v-if="d.prCsvTime" class="time">{{
                    formatGmt8(d.prCsvTime)
                  }}</span>
                </div>
                <div class="cell-line">
                  <n-button
                    size="tiny"
                    :disabled="d.tr.state !== '完成'"
                    @click="downloadCsvPath(d.translatedPath, d.title, '翻译')"
                  >
                    下载人工翻译CSV
                  </n-button>
                  <n-button
                    v-if="d.pr.state === '待认领'"
                    size="tiny"
                    type="info"
                    :loading="busy === d.number"
                    @click="claim(d, 'pr')"
                  >
                    认领
                  </n-button>
                  <n-button
                    v-if="
                      d.pr.user === me &&
                      d.tr.state === '完成' &&
                      d.pr.state !== '完成'
                    "
                    size="tiny"
                    type="primary"
                    @click="open(d, 'pr')"
                  >
                    开始在线校对
                  </n-button>
                </div>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
      <n-empty v-else-if="!loading" description="工作仓库暂无剧情" />
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { NButton, NTag, NEmpty, NAlert, NCheckbox } from 'naive-ui'
import { store } from '../../store'
import PushHeader from '../translate/push/PushHeader.vue'
import FileSaver from 'file-saver'
import { displayUser, loadUsers } from '../../helper/users'
import {
  WORK_OWNER,
  WORK_REPO,
  docFromIssue,
  formatGmt8,
  fileCommitTime,
  aiCompleteTranslation,
  isArchivedIssue,
  applyTrack,
  editorUrlForPath,
  workRawUrl,
  type DocTask,
  type TrackKey,
  type TrackState,
} from '../../helper/workflow'

const router = useRouter()
const loading = ref(false)
const busy = ref<number | null>(null)
const batchBusy = ref(false)
const error = ref('')
const onlyMine = ref(false)
const docs = ref<DocTask[]>([])
// 多选（批量认领用）
const selected = ref<Set<number>>(new Set())

const allSelected = computed(
  () => rows.value.length > 0 && rows.value.every((d) => selected.value.has(d.number))
)
function toggleSel(n: number, v: boolean) {
  const s = new Set(selected.value)
  if (v) s.add(n)
  else s.delete(n)
  selected.value = s
}
function toggleAll(v: boolean) {
  selected.value = v ? new Set(rows.value.map((d) => d.number)) : new Set()
}

// 批量认领：只处理该轨仍为"待认领"的行，其余静默跳过
async function batchClaim(k: TrackKey) {
  if (!store.octokitWrapper) return
  batchBusy.value = true
  let done = 0
  try {
    for (const d of rows.value) {
      if (!selected.value.has(d.number)) continue
      if (d[k].state !== '待认领') continue
      await applyTrack(store.octokitWrapper, d.number, k, {
        user: me.value,
        state: '进行中',
      })
      done++
    }
    selected.value = new Set()
    await refresh()
    alert(`批量认领${k === 'tr' ? '翻译' : '校对'}完成：${done} 个`)
  } catch (e: any) {
    alert(`批量认领中断：${e?.message || e}（已完成 ${done} 个）`)
    await refresh()
  }
  batchBusy.value = false
}

// 一键完成翻译：直接采用 AI 机翻稿，译者=CSV 里的 AI 名
async function aiComplete(d: DocTask) {
  if (!store.octokitWrapper) return
  if (!confirm(`直接采用 AI 机翻稿作为 ${d.title} 的翻译成稿？`)) return
  busy.value = d.number
  try {
    await aiCompleteTranslation(store.octokitWrapper, d)
    await refresh()
  } catch (e: any) {
    alert(`一键完成失败：${e?.message || e}`)
  }
  busy.value = null
}

const me = computed(() => store.octokitWrapper?.userMeta?.username || '')

function isMine(d: DocTask) {
  return d.tr.user === me.value || d.pr.user === me.value
}
const rows = computed(() =>
  onlyMine.value ? docs.value.filter(isMine) : docs.value
)

function tagType(s: TrackState) {
  return s === '完成' ? 'success' : s === '进行中' ? 'warning' : 'default'
}

function trackLabel(t: DocTask['tr']) {
  return t.user ? `${displayUser(t.user)} · ${t.state}` : '待认领'
}

// 校对列显示文案：未认领始终"待认领"；已认领但翻译未完成显示"待校对"
function prCellLabel(d: DocTask) {
  if (!d.pr.user) return '待认领'
  return `${displayUser(d.pr.user)} · ${
    d.tr.state !== '完成' ? '待校对' : d.pr.state
  }`
}

async function refresh() {
  if (!store.octokitWrapper) return
  loading.value = true
  error.value = ''
  try {
    await loadUsers(store.octokitWrapper)
    const issues = await store.octokitWrapper.listIssues(WORK_OWNER, WORK_REPO)
    docs.value = (issues as any[])
      .filter((i) => !i.pull_request && !isArchivedIssue(i))
      .map(docFromIssue)
      .sort((a, b) => a.title.localeCompare(b.title))
    // 异步补每行 翻译/校对 CSV 的最后 commit 时间（有对应阶段产物才拉）
    const w = store.octokitWrapper
    await Promise.all(
      docs.value.map(async (d) => {
        if (d.tr.state === '完成')
          d.trCsvTime = await fileCommitTime(w, d.translatedPath)
        if (d.pr.state === '完成')
          d.prCsvTime = await fileCommitTime(w, d.proofreadPath)
      })
    )
  } catch (e: any) {
    error.value = `加载失败：${e?.message || e}（确认工作仓库存在且有权限）`
  }
  loading.value = false
}

async function downloadCsvPath(path: string, title: string, label: string) {
  const r = await fetch(workRawUrl(path))
  if (!r.ok) {
    alert(`${label}CSV下载失败: ${r.status}`)
    return
  }
  FileSaver.saveAs(await r.blob(), `${title}_${label}.csv`)
}

function open(d: DocTask, role?: TrackKey) {
  const path =
    role === 'tr'
      ? d.aiPath
      : role === 'pr'
      ? d.translatedPath
      : d.tr.state === '完成'
      ? d.translatedPath
      : d.aiPath
  if (!path) {
    alert('该剧情缺少文件路径标记')
    return
  }
  router.push(editorUrlForPath(path, d.number, role))
}

// 认领某轨：写 我:进行中（不自动跳转，认领后自己点"打开"）
async function claim(d: DocTask, k: TrackKey) {
  if (!store.octokitWrapper) return
  busy.value = d.number
  try {
    await applyTrack(store.octokitWrapper, d.number, k, {
      user: me.value,
      state: '进行中',
    })
    await refresh()
  } catch (e: any) {
    alert(`认领失败：${e?.message || e}`)
  }
  busy.value = null
}

watch(
  () => store.octokitWrapper?.userMeta?.username,
  (u) => {
    if (u) refresh()
  }
)
onMounted(() => {
  if (store.octokitWrapper?.userMeta) refresh()
})
</script>

<script lang="ts">
export default {
  name: 'WorkbenchPanel',
}
</script>

<style scoped>
.workbench {
  max-width: 860px;
  margin: 0 auto;
  text-align: left;
}
.hint {
  margin: 20px 0;
  color: #888;
}
.build-mark {
  font-size: 12px;
  color: #c0392b;
  margin: 4px 0;
}
.toolbar {
  display: flex;
  gap: 12px;
  align-items: center;
  margin: 10px 0;
}
.me {
  color: #888;
  font-size: 12px;
}
.grid {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
}
.grid th,
.grid td {
  border-bottom: 1px solid #eee;
  padding: 7px 8px;
  text-align: left;
}
.grid th {
  color: #888;
  font-weight: 500;
  font-size: 13px;
}
.sel-col {
  width: 34px;
}
.grid tr.mine {
  background: #f6fbff;
}
.doc {
  word-break: break-all;
}
.doc .parts {
  color: #aaa;
  font-size: 12px;
  margin-left: 6px;
}
/* 每轨单元格：第一行 状态+时间，第二行 功能按钮 */
.cell-col {
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.cell-line {
  display: flex;
  gap: 6px;
  align-items: center;
  flex-wrap: wrap;
}
.time {
  color: #999;
  font-size: 12px;
  white-space: nowrap;
}
</style>
