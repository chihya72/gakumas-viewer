<template>
  <div class="admin">
    <push-header title="管理" />
    <div v-if="!store.octokitWrapper?.userMeta" class="hint">
      请先登录 GitHub。
    </div>
    <template v-else>
      <h3>我的个人ID</h3>
      <div class="profile">
        <span class="hint">GitHub ID：{{ me }}</span>
        <n-input v-model:value="myName" size="small" placeholder="个人ID" />
        <n-button
          size="small"
          type="primary"
          :loading="savingMe"
          @click="saveMe"
        >
          保存我的ID
        </n-button>
      </div>

      <n-alert v-if="!canAdmin" type="warning" :bordered="false">
        当前账号没有管理权限。
      </n-alert>
    </template>

    <template v-if="store.octokitWrapper?.userMeta && canAdmin">
      <div class="toolbar">
        <n-button size="small" :loading="loading" @click="refresh"
          >刷新</n-button
        >
        <n-button
          size="small"
          type="primary"
          :loading="savingUsers"
          @click="saveUserRows"
        >
          保存用户
        </n-button>
        <n-button
          size="small"
          type="warning"
          :disabled="!selectedCount"
          :loading="batching"
          @click="batchArchive"
        >
          批量过时存档({{ selectedCount }})
        </n-button>
      </div>

      <n-alert v-if="error" type="error" :bordered="false">{{ error }}</n-alert>

      <h3>上传新文档</h3>
      <div class="upload">
        <input type="file" accept=".csv" @change="onUploadFile" />
        <n-input
          v-model:value="uploadTitle"
          size="small"
          placeholder="剧情名，如 adv_cidol-hume-3-018_03"
        />
        <n-select
          v-model:value="uploadStage"
          size="small"
          :options="uploadStageOptions"
        />
        <n-button
          size="small"
          type="primary"
          :disabled="!canUpload"
          :loading="uploading"
          @click="uploadDoc"
        >
          上传并开工单
        </n-button>
      </div>

      <h3>用户与个人ID</h3>
      <table class="grid users">
        <thead>
          <tr>
            <th>GitHub ID</th>
            <th>个人ID</th>
            <th>权限</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(u, i) in userRows" :key="i">
            <td><n-input v-model:value="u.github" size="small" /></td>
            <td><n-input v-model:value="u.name" size="small" /></td>
            <td>
              <n-select
                v-model:value="u.role"
                size="small"
                :options="roleOptions"
              />
            </td>
            <td>
              <n-button size="tiny" @click="userRows.splice(i, 1)"
                >删除</n-button
              >
            </td>
          </tr>
        </tbody>
      </table>
      <n-button size="small" @click="addUser">新增用户</n-button>

      <h3>文件状态</h3>
      <table v-if="docs.length" class="grid docs">
        <thead>
          <tr>
            <th class="pick-col"></th>
            <th>剧情</th>
            <th>译者</th>
            <th>翻译状态</th>
            <th>校对者</th>
            <th>校对状态</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="d in docs" :key="d.number">
            <td>
              <input
                type="checkbox"
                :checked="selected.has(d.number)"
                :disabled="isArchived(d)"
                @change="toggleSelected(d.number, $event)"
              />
            </td>
            <td class="title">{{ d.title }}</td>
            <td>
              <n-select
                v-model:value="d.tr.user"
                size="small"
                :options="userOptions"
              />
            </td>
            <td>
              <n-select
                v-model:value="d.tr.state"
                size="small"
                :options="stateOptions"
              />
            </td>
            <td>
              <n-select
                v-model:value="d.pr.user"
                size="small"
                :options="userOptions"
              />
            </td>
            <td>
              <n-select
                v-model:value="d.pr.state"
                size="small"
                :options="stateOptions"
              />
            </td>
            <td>
              <div class="actions">
                <n-button
                  size="tiny"
                  type="primary"
                  :loading="busy === d.number"
                  @click="saveDoc(d)"
                >
                  保存
                </n-button>
                <n-button
                  v-if="isArchived(d)"
                  size="tiny"
                  type="success"
                  :loading="busy === d.number"
                  @click="restore(d)"
                >
                  恢复
                </n-button>
                <n-button
                  v-else
                  size="tiny"
                  type="warning"
                  :loading="busy === d.number"
                  @click="archive(d)"
                >
                  过时存档
                </n-button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
      <n-empty v-else-if="!loading" description="暂无文件" />
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { NAlert, NButton, NEmpty, NInput, NSelect } from 'naive-ui'
import PushHeader from '../translate/push/PushHeader.vue'
import { store } from '../../store'
import {
  users,
  isAdmin,
  loadUsers,
  saveMyName,
  saveUsers,
  type UserRole,
  type WorkUser,
} from '../../helper/users'
import {
  WORK_OWNER,
  WORK_REPO,
  STATES,
  archiveIssue,
  createWorkIssue,
  docFromIssue,
  isArchivedIssue,
  pushContentToWorkPath,
  restoreIssue,
  stagePathForTitle,
  updateTracks,
  type DocTask,
} from '../../helper/workflow'

interface UserRow {
  github: string
  name: string
  role: UserRole
}

const loading = ref(false)
const savingUsers = ref(false)
const savingMe = ref(false)
const batching = ref(false)
const uploading = ref(false)
const busy = ref<number | null>(null)
const error = ref('')
const docs = ref<DocTask[]>([])
const archived = ref<Set<number>>(new Set())
const selected = ref<Set<number>>(new Set())
const userRows = ref<UserRow[]>([])
const myName = ref('')
const uploadFile = ref<File | null>(null)
const uploadTitle = ref('')
const uploadStage = ref<'ai' | 'translated' | 'proofread'>('ai')

const me = computed(() => store.octokitWrapper?.userMeta?.username || '')
const canAdmin = computed(() => isAdmin(me.value))
const selectedCount = computed(() => selected.value.size)
const canUpload = computed(
  () => !!uploadFile.value && !!uploadTitle.value.trim()
)

const roleOptions = [
  { label: '用户', value: 'user' },
  { label: '管理', value: 'admin' },
]
const stateOptions = STATES.map((s) => ({ label: s, value: s }))
const uploadStageOptions = [
  { label: 'AI机翻CSV', value: 'ai' },
  { label: '人工翻译CSV', value: 'translated' },
  { label: '人工校对CSV', value: 'proofread' },
]
const userOptions = computed(() => [
  { label: '未认领', value: '' },
  ...Object.entries(users).map(([github, u]) => ({
    label: `${u.name} (${github})`,
    value: github,
  })),
])

function syncUserRows() {
  userRows.value = Object.entries(users)
    .map(([github, u]) => ({ github, name: u.name, role: u.role }))
    .sort((a, b) => a.github.localeCompare(b.github))
  myName.value = users[me.value]?.name || me.value
}

function addUser() {
  userRows.value.push({ github: '', name: '', role: 'user' })
}

function isArchived(d: DocTask) {
  return archived.value.has(d.number)
}

function toggleSelected(n: number, e: Event) {
  const next = new Set(selected.value)
  ;(e.target as HTMLInputElement).checked ? next.add(n) : next.delete(n)
  selected.value = next
}

async function refresh() {
  if (!store.octokitWrapper) return
  loading.value = true
  error.value = ''
  try {
    await loadUsers(store.octokitWrapper)
    syncUserRows()
    const issues = await store.octokitWrapper.listIssues(
      WORK_OWNER,
      WORK_REPO,
      {
        state: 'all',
      }
    )
    const nextArchived = new Set<number>()
    docs.value = (issues as any[])
      .filter((i) => !i.pull_request)
      .map((i) => {
        if (isArchivedIssue(i)) nextArchived.add(i.number)
        return docFromIssue(i)
      })
      .sort((a, b) => a.title.localeCompare(b.title))
    archived.value = nextArchived
    selected.value = new Set()
  } catch (e: any) {
    error.value = `加载失败：${e?.message || e}`
  }
  loading.value = false
}

async function saveMe() {
  if (!store.octokitWrapper || !me.value) return
  savingMe.value = true
  try {
    await saveMyName(store.octokitWrapper, me.value, myName.value)
    syncUserRows()
  } catch (e: any) {
    alert(`保存个人ID失败：${e?.message || e}`)
  }
  savingMe.value = false
}

async function saveUserRows() {
  if (!store.octokitWrapper) return
  const next: Record<string, WorkUser> = {}
  for (const u of userRows.value) {
    const github = u.github.trim()
    const name = u.name.trim()
    if (!github) continue
    next[github] = { name: name || github, role: u.role }
  }
  savingUsers.value = true
  try {
    await saveUsers(store.octokitWrapper, next)
    syncUserRows()
  } catch (e: any) {
    alert(`保存用户失败：${e?.message || e}`)
  }
  savingUsers.value = false
}

async function saveDoc(d: DocTask) {
  if (!store.octokitWrapper) return
  busy.value = d.number
  try {
    await updateTracks(store.octokitWrapper, d.number, d.tr, d.pr)
    await refresh()
  } catch (e: any) {
    alert(`保存状态失败：${e?.message || e}`)
  }
  busy.value = null
}

async function batchArchive() {
  if (!store.octokitWrapper) return
  const picked = docs.value.filter(
    (d) => selected.value.has(d.number) && !isArchived(d)
  )
  if (!picked.length) return
  if (!confirm(`过时存档 ${picked.length} 个文件？`)) return
  batching.value = true
  try {
    for (const d of picked) await archiveIssue(store.octokitWrapper, d.number)
    await refresh()
  } catch (e: any) {
    alert(`批量存档失败：${e?.message || e}`)
  }
  batching.value = false
}

function onUploadFile(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0] || null
  uploadFile.value = file
  if (file && !uploadTitle.value)
    uploadTitle.value = file.name.replace(/\.csv$/i, '')
}

async function uploadDoc() {
  if (!store.octokitWrapper || !uploadFile.value) return
  const title = uploadTitle.value.trim().replace(/\.csv$/i, '')
  if (!title) return
  if (docs.value.some((d) => d.title === title)) {
    alert('已存在同名工单，请在文件状态里处理')
    return
  }
  uploading.value = true
  try {
    const text = await uploadFile.value.text()
    const bytes = new TextEncoder().encode(text)
    let bin = ''
    bytes.forEach((b) => (bin += String.fromCharCode(b)))
    await pushContentToWorkPath(
      store.octokitWrapper,
      stagePathForTitle(title, uploadStage.value),
      btoa(bin),
      `上传 ${title}`
    )
    await createWorkIssue(
      store.octokitWrapper,
      title,
      uploadStage.value,
      me.value
    )
    uploadFile.value = null
    uploadTitle.value = ''
    await refresh()
  } catch (e: any) {
    alert(`上传失败：${e?.message || e}`)
  }
  uploading.value = false
}

async function archive(d: DocTask) {
  if (!store.octokitWrapper) return
  busy.value = d.number
  try {
    await archiveIssue(store.octokitWrapper, d.number)
    await refresh()
  } catch (e: any) {
    alert(`存档失败：${e?.message || e}`)
  }
  busy.value = null
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
  name: 'AdminPanel',
}
</script>

<style scoped>
.admin {
  max-width: 1120px;
  margin: 0 auto;
  text-align: left;
}
.hint {
  color: #888;
}
.toolbar,
.profile,
.upload,
.actions {
  display: flex;
  gap: 8px;
  align-items: center;
}
.toolbar {
  margin: 10px 0;
}
h3 {
  margin: 18px 0 8px;
  font-size: 16px;
}
.grid {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
  margin-bottom: 8px;
}
.grid th,
.grid td {
  border-bottom: 1px solid #eee;
  padding: 7px 6px;
  text-align: left;
}
.grid th {
  color: #888;
  font-weight: 500;
  font-size: 13px;
}
.profile .n-input {
  max-width: 220px;
}
.upload {
  margin-bottom: 10px;
}
.upload .n-input {
  max-width: 320px;
}
.upload .n-select {
  width: 130px;
}
.pick-col {
  width: 28px;
}
.users th:nth-child(1),
.users th:nth-child(2) {
  width: 34%;
}
.users th:nth-child(3) {
  width: 120px;
}
.users th:nth-child(4) {
  width: 70px;
}
.docs th:nth-child(2) {
  width: 28%;
}
.docs th:nth-child(3),
.docs th:nth-child(5) {
  width: 17%;
}
.docs th:nth-child(4),
.docs th:nth-child(6) {
  width: 110px;
}
.docs th:nth-child(7) {
  width: 170px;
}
.title {
  word-break: break-all;
  font-weight: 600;
}
</style>
