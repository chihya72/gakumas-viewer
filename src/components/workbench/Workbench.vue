<!-- 汉化工作台：全文档总览。一行一剧情，翻译/校对两条独立轨道，各自显示认领人+状态、可各自认领。
     "完成"在编辑器里点，不在这里。 -->
<template>
  <div class="workbench">
    <push-header title="汉化工作台" />
    <div class="build-mark">构建标记 B15（若看不到此行=仍是旧缓存）</div>

    <div v-if="!store.octokitWrapper?.userMeta" class="hint">
      请先登录 GitHub 账号（需已加入工作组，即对工作仓库有写权限）。
    </div>

    <template v-else>
      <div class="toolbar">
        <n-button size="small" :loading="loading" @click="refresh">刷新</n-button>
        <span class="me">我：{{ displayUser(me) }}</span>
        <n-checkbox v-model:checked="onlyMine">只看我的</n-checkbox>
      </div>

      <n-alert v-if="error" type="error" :bordered="false">{{ error }}</n-alert>

      <table v-if="rows.length" class="grid">
        <thead>
          <tr>
            <th>剧情</th>
            <th>翻译</th>
            <th>校对</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="d in rows" :key="d.number" :class="{ mine: isMine(d) }">
            <td class="doc">
              <a href="javascript:;" @click="open(d)">{{ d.title }}</a>
            </td>
            <!-- 翻译轨 -->
            <td>
              <div class="cell">
                <n-tag size="small" :type="tagType(d.tr.state)" :bordered="false">
                  {{ trackLabel(d.tr) }}
                </n-tag>
                <n-button size="tiny" @click="downloadCsvPath(d.aiPath, d.title, 'AI机翻')">
                  AI机翻CSV
                </n-button>
                <n-button
                  size="tiny"
                  type="warning"
                  :loading="busy === d.number"
                  @click="archive(d)"
                >
                  存档
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
                  v-else-if="d.tr.user === me && d.tr.state !== '完成'"
                  size="tiny"
                  @click="open(d, 'tr')"
                >
                  打开
                </n-button>
              </div>
            </td>
            <!-- 校对轨：可随时认领；翻译未完成时显示"待校对"、不给打开（不能提前校对） -->
            <td>
              <div class="cell">
                <n-tag
                  size="small"
                  :type="d.tr.state === '完成' ? tagType(d.pr.state) : 'default'"
                  :bordered="false"
                >
                  {{ prCellLabel(d) }}
                </n-tag>
                <n-button
                  size="tiny"
                  :disabled="d.tr.state !== '完成'"
                  @click="downloadCsvPath(d.translatedPath, d.title, '翻译')"
                >
                  翻译CSV
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
                  v-else-if="
                    d.pr.user === me &&
                    d.tr.state === '完成' &&
                    d.pr.state !== '完成'
                  "
                  size="tiny"
                  @click="open(d, 'pr')"
                >
                  打开
                </n-button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
      <n-empty v-else-if="!loading" description="工作仓库暂无剧情" />

      <template v-if="completed.length">
        <h3>已完成（{{ completed.length }}）</h3>
        <div v-for="d in completed" :key="d.number" class="stock-row">
          <n-tag size="small" type="success" :bordered="false">完成</n-tag>
          <span class="stock-title">{{ d.title }}</span>
          <span class="stock-user">翻译：{{ displayUser(d.tr.user) }}</span>
          <span class="stock-user">校对：{{ displayUser(d.pr.user) }}</span>
          <n-button size="tiny" @click="downloadCsvPath(d.proofreadPath, d.title, '校对')">
            校对CSV
          </n-button>
          <n-button size="tiny" @click="downloadChineseTxt(d)">
            纯中文TXT
          </n-button>
        </div>
      </template>
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
import { extractInfoFromCsvText } from '../../helper/csv'
import { displayUser } from '../../helper/users'
import {
  WORK_OWNER,
  WORK_REPO,
  docFromIssue,
  archiveIssue,
  isArchivedIssue,
  applyTrack,
  editorUrlForPath,
  workRawUrl,
  fetchRawTxt,
  buildChineseTxt,
  fetchNameDict,
  type DocTask,
  type TrackKey,
  type TrackState,
} from '../../helper/workflow'

const router = useRouter()
const loading = ref(false)
const busy = ref<number | null>(null)
const error = ref('')
const onlyMine = ref(false)
const docs = ref<DocTask[]>([])
const completed = ref<DocTask[]>([])

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
    const issues = await store.octokitWrapper.listIssues(WORK_OWNER, WORK_REPO)
    docs.value = (issues as any[])
      .filter((i) => !i.pull_request && !isArchivedIssue(i))
      .map(docFromIssue)
      .sort((a, b) => a.title.localeCompare(b.title))
    const closed = await store.octokitWrapper.listIssues(
      WORK_OWNER,
      WORK_REPO,
      { state: 'closed' }
    )
    completed.value = (closed as any[])
      .filter((i) => !i.pull_request && !isArchivedIssue(i))
      .map(docFromIssue)
      .sort((a, b) => a.title.localeCompare(b.title))
  } catch (e: any) {
    error.value = `加载失败：${e?.message || e}（确认工作仓库存在且有权限）`
  }
  loading.value = false
}

async function archive(d: DocTask) {
  if (!store.octokitWrapper) return
  if (!confirm(`存档 ${d.title}？`)) return
  busy.value = d.number
  try {
    await archiveIssue(store.octokitWrapper, d.number)
    await refresh()
  } catch (e: any) {
    alert(`存档失败：${e?.message || e}`)
  }
  busy.value = null
}

async function downloadCsvPath(path: string, title: string, label: string) {
  const r = await fetch(workRawUrl(path))
  if (!r.ok) {
    alert(`${label}CSV下载失败: ${r.status}`)
    return
  }
  FileSaver.saveAs(await r.blob(), `${title}_${label}.csv`)
}

// 下载纯中文 TXT：原始 txt(campus 权威源) + 成品 CSV 在浏览器合并
async function downloadChineseTxt(d: DocTask) {
  const [rawTxt, csvResp, dict] = await Promise.all([
    fetchRawTxt(d.title),
    fetch(workRawUrl(d.proofreadPath)),
    fetchNameDict(),
  ])
  if (rawTxt === null) {
    alert('原始 txt 不存在（campus 仓库与工作仓库 raw/ 均未找到）')
    return
  }
  if (!csvResp.ok) {
    alert(`CSV 下载失败: ${csvResp.status}`)
    return
  }
  try {
    const { data } = extractInfoFromCsvText(await csvResp.text())
    const merged = buildChineseTxt(rawTxt, data, dict)
    FileSaver.saveAs(
      new Blob([merged], { type: 'text/plain;charset=utf-8' }),
      `${d.title}.txt`
    )
  } catch (e: any) {
    alert(`纯中文TXT生成失败：${e?.message || e}`)
  }
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
.grid tr.mine {
  background: #f6fbff;
}
.doc .parts {
  color: #aaa;
  font-size: 12px;
  margin-left: 6px;
}
.cell {
  display: flex;
  gap: 6px;
  align-items: center;
}
.stock-row {
  display: flex;
  gap: 8px;
  align-items: center;
  padding: 6px 0;
  border-bottom: 1px solid #eee;
}
.stock-title {
  flex: 1;
  word-break: break-all;
}
.stock-user {
  color: #666;
  font-size: 12px;
  white-space: nowrap;
}
</style>
