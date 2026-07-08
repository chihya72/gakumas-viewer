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
import { ref, onMounted, watch } from 'vue'
import { NButton, NTag, NEmpty, NAlert } from 'naive-ui'
import PushHeader from '../translate/push/PushHeader.vue'
import { store } from '../../store'
import { displayUser, loadUsers } from '../../helper/users'
import {
  WORK_OWNER,
  WORK_REPO,
  docFromIssue,
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
      .sort((a, b) => b.number - a.number)
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
</script>

<script lang="ts">
export default {
  name: 'ArchivePanel',
}
</script>

<style scoped>
.workbench {
  max-width: 980px;
  margin: 0 auto;
  text-align: left;
}
.hint,
.user {
  color: #888;
}
.toolbar {
  margin: 10px 0;
}
.row {
  display: flex;
  gap: 8px;
  align-items: center;
  padding: 7px 0;
  border-bottom: 1px solid #eee;
}
.title {
  flex: 1;
  font-weight: 600;
  word-break: break-all;
}
.user {
  font-size: 12px;
  white-space: nowrap;
}
</style>
