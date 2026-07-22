<template>
  <div class="workbench">
    <push-header title="已完成历史" />
    <div v-if="!store.octokitWrapper?.userMeta" class="hint">
      请先登录 GitHub。
    </div>
    <template v-else>
      <div class="toolbar">
        <n-button size="small" :loading="loading" @click="refresh"
          >刷新</n-button
        >
      </div>
      <n-alert v-if="error" type="error" :bordered="false">{{ error }}</n-alert>
      <doc-filters v-slot="{ rows: filteredRows }" :docs="rows" @page="onPage">
        <div v-for="d in filteredRows" :key="d.number" class="row">
          <span class="source-time">{{
            formatGmt8(d.sourceCommitTime || '')
          }}</span>
          <span class="title">{{ d.title }}</span>
          <span class="user"
            >翻译：{{ displayUser(d.tr.user)
            }}<template v-if="d.trCsvTime">
              · {{ formatGmt8(d.trCsvTime) }}</template
            ></span
          >
          <span class="user"
            >校对：{{ displayUser(d.pr.user)
            }}<template v-if="d.prCsvTime">
              · {{ formatGmt8(d.prCsvTime) }}</template
            ></span
          >
          <n-button size="tiny" @click="downloadCsv(d)">下载CSV</n-button>
          <n-button size="tiny" @click="downloadChineseTxt(d)"
            >下载TXT</n-button
          >
          <n-button size="tiny" @click="openEditor(d, 'tr')">重新翻译</n-button>
          <n-button size="tiny" @click="openEditor(d, 'pr')">
            重新校对
          </n-button>
        </div>
        <n-empty
          v-if="!loading && !filteredRows.length"
          :description="
            rows.length ? '没有符合筛选条件的文件' : '暂无已完成文件'
          "
        />
      </doc-filters>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, onActivated, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { NButton, NEmpty, NAlert } from 'naive-ui'
import FileSaver from 'file-saver'
import PushHeader from '../translate/push/PushHeader.vue'
import DocFilters from './DocFilters.vue'
import { store } from '../../store'
import { extractInfoFromCsvText } from '../../helper/csv'
import { displayUser, loadUsers } from '../../helper/users'
import {
  WORK_OWNER,
  WORK_REPO,
  buildChineseTxt,
  docFromIssue,
  editorUrlForPath,
  fetchNameDict,
  fetchRawTxt,
  fillDocSourceCommitTimes,
  fillDocStageCommitTimes,
  formatGmt8,
  isArchivedIssue,
  workRawUrl,
  type DocTask,
  type TrackKey,
} from '../../helper/workflow'

const router = useRouter()
const loading = ref(false)
const error = ref('')
const rows = ref<DocTask[]>([])
let lastRefreshAt = 0

// 重新修改：打开已完成阶段文件；再次完成会把对应作者更新为当前用户。
function openEditor(d: DocTask, role: TrackKey) {
  const path = role === 'tr' ? d.translatedPath : d.proofreadPath
  if (!path) {
    alert('该文件缺少路径标记')
    return
  }
  router.push(editorUrlForPath(path, d.number, role))
}

async function refresh() {
  if (!store.octokitWrapper) return
  if (loading.value) return
  loading.value = true
  error.value = ''
  try {
    const [, issues] = await Promise.all([
      loadUsers(store.octokitWrapper),
      store.octokitWrapper.listIssues(WORK_OWNER, WORK_REPO, { state: 'closed' }),
    ])
    const loaded = (issues as any[])
      .filter((i) => !i.pull_request && !isArchivedIssue(i))
      .map(docFromIssue)
    // 完成时间不在这里查：等 DocFilters 报出当前页再按页补，见 onPage
    rows.value = await fillDocSourceCommitTimes(store.octokitWrapper, loaded)
    lastRefreshAt = Date.now()
  } catch (e: any) {
    error.value = `加载失败：${e?.message || e}`
  }
  loading.value = false
}

// 只给当前页没查过的行补翻译/校对完成时间；缓存命中的不重复请求
async function onPage(pageRows: DocTask[]) {
  if (!store.octokitWrapper) return
  const pending = pageRows.filter((d) => d.trCsvTime === undefined)
  if (!pending.length) return
  const filled = await fillDocStageCommitTimes(store.octokitWrapper, pending)
  const byNumber = new Map(filled.map((d) => [d.number, d]))
  rows.value = rows.value.map((d) => byNumber.get(d.number) || d)
}

async function downloadCsv(d: DocTask) {
  const r = await fetch(workRawUrl(d.proofreadPath))
  if (!r.ok) {
    alert(`校对CSV下载失败: ${r.status}`)
    return
  }
  FileSaver.saveAs(await r.blob(), `${d.title}_校对.csv`)
}

async function downloadChineseTxt(d: DocTask) {
  const [rawTxt, csvResp, dict] = await Promise.all([
    fetchRawTxt(d.title),
    fetch(workRawUrl(d.proofreadPath)),
    fetchNameDict(),
  ])
  if (rawTxt === null || !csvResp.ok) {
    alert('纯中文TXT生成失败：原始TXT或校对CSV不存在')
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

watch(
  () => store.octokitWrapper?.userMeta?.username,
  (u) => {
    if (u) refresh()
  }
)
onMounted(() => {
  if (store.octokitWrapper?.userMeta) refresh()
})
onActivated(() => {
  if (store.octokitWrapper?.userMeta && Date.now() - lastRefreshAt > 30_000) refresh()
})
</script>

<script lang="ts">
export default {
  name: 'HistoryPanel',
}
</script>

<style scoped>
.workbench {
  width: min(1170px, 100%);
  max-width: 1170px;
  margin: 0 auto;
  text-align: left;
}
.hint,
.user {
  color: #64748b;
}
.toolbar {
  margin: 10px 0;
}
.row {
  display: grid;
  grid-template-columns: 112px minmax(196px, 1fr) 190px 190px repeat(4, 82px);
  gap: 10px;
  align-items: center;
  padding: 10px 0;
  border-bottom: 1px solid #e2e8f0;
}
.title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 600;
}
.user {
  font-size: 12px;
  white-space: nowrap;
}
.row :deep(.n-button) {
  width: 82px;
  white-space: nowrap;
}
.source-time {
  color: #64748b;
  font-size: 12px;
  white-space: nowrap;
}

@media (max-width: 720px) {
  .row {
    grid-template-columns: 1fr 1fr;
    gap: 8px;
    padding: 12px;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.82);
    margin-bottom: 10px;
  }

  .source-time,
  .title,
  .user {
    grid-column: 1 / -1;
  }

  .title {
    white-space: normal;
  }

  .user {
    white-space: normal;
  }

  .row :deep(.n-button) {
    width: 100%;
    min-height: 36px;
  }
}
</style>
