<template>
  <div class="workbench">
    <push-header title="未完成存档" />
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
      <div v-for="d in rows" :key="d.number" class="row">
        <span class="source-time">{{
          formatGmt8(d.sourceCommitTime || '')
        }}</span>
        <n-tag size="small" type="warning" :bordered="false">已存档</n-tag>
        <span class="title">{{ d.title }}</span>
        <span class="user">翻译：{{ trackText(d.tr) }}</span>
        <span class="user">校对：{{ trackText(d.pr) }}</span>
        <n-button
          size="tiny"
          type="success"
          :loading="busy === d.number"
          @click="restore(d)"
        >
          恢复
        </n-button>
      </div>
      <n-empty v-if="!loading && !rows.length" description="暂无存档文件" />
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, onActivated, onMounted, watch } from 'vue'
import { NButton, NTag, NEmpty, NAlert } from 'naive-ui'
import PushHeader from '../translate/push/PushHeader.vue'
import { store } from '../../store'
import { displayUser, loadUsers } from '../../helper/users'
import {
  WORK_OWNER,
  WORK_REPO,
  docFromIssue,
  fillDocSourceCommitTimes,
  formatGmt8,
  isArchivedIssue,
  restoreIssue,
  type DocTask,
  type Track,
} from '../../helper/workflow'

const loading = ref(false)
const busy = ref<number | null>(null)
const error = ref('')
const rows = ref<DocTask[]>([])

function trackText(t: Track) {
  return t.user ? `${displayUser(t.user)} · ${t.state}` : '待认领'
}

async function refresh() {
  if (!store.octokitWrapper) return
  if (loading.value) return
  loading.value = true
  error.value = ''
  try {
    await loadUsers(store.octokitWrapper)
    const issues = await store.octokitWrapper.listIssues(
      WORK_OWNER,
      WORK_REPO,
      {
        state: 'closed',
      }
    )
    rows.value = (issues as any[])
      .filter((i) => !i.pull_request && isArchivedIssue(i))
      .map(docFromIssue)
    rows.value = await fillDocSourceCommitTimes(
      store.octokitWrapper,
      rows.value
    )
  } catch (e: any) {
    error.value = `加载失败：${e?.message || e}`
  }
  loading.value = false
}

async function restore(d: DocTask) {
  if (!store.octokitWrapper) return
  busy.value = d.number
  try {
    await restoreIssue(store.octokitWrapper, d.number)
    await refresh()
  } catch (e: any) {
    alert(`恢复失败：${e?.message || e}`)
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
onActivated(() => {
  if (store.octokitWrapper?.userMeta) refresh()
})
</script>

<script lang="ts">
export default {
  name: 'ArchivePanel',
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
  grid-template-columns: 112px auto minmax(196px, 1fr) 170px 170px 82px;
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
    grid-template-columns: auto 1fr;
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

  .title,
  .user {
    white-space: normal;
  }

  .row :deep(.n-button) {
    width: 100%;
    min-height: 36px;
  }
}
</style>
