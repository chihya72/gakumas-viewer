<template>
  <div class="admin">
    <push-header title="管理" />
    <div v-if="!store.octokitWrapper?.userMeta" class="hint">
      请先登录 GitHub。
    </div>
    <template v-else>
      <div v-if="canAdmin" class="toolbar">
        <n-button size="small" :loading="loading" @click="refresh"
          >刷新</n-button
        >
        <n-button size="small" type="primary" @click="showUsers = true">
          用户管理
        </n-button>
      </div>

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

      <n-modal
        v-model:show="showUsers"
        preset="card"
        title="用户管理"
        style="width: min(1000px, calc(100vw - 32px))"
      >
        <n-alert
          v-if="userError"
          type="error"
          :bordered="false"
          class="user-rule"
        >
          {{ userError }}
        </n-alert>
        <n-alert type="info" :bordered="false" class="user-rule">
          每名用户必须填写唯一的个人 ID；GitHub ID 与 QQ 号至少填写一项。
        </n-alert>
        <div class="table-scroll">
          <table class="grid users">
            <thead>
              <tr>
                <th>个人 ID（必填）</th>
                <th>GitHub ID（可选）</th>
                <th>QQ 号（可选）</th>
                <th>权限</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(u, i) in userRows" :key="i">
                <td>
                  <n-input
                    v-model:value="u.id"
                    size="small"
                    aria-label="个人 ID"
                    placeholder="必填"
                  />
                </td>
                <td>
                  <n-input
                    v-model:value="u.github"
                    size="small"
                    aria-label="GitHub ID"
                    placeholder="可留空"
                  />
                </td>
                <td>
                  <n-input
                    v-model:value="u.qq"
                    size="small"
                    aria-label="QQ 号"
                    placeholder="可留空"
                  />
                </td>
                <td>
                  <n-select
                    v-model:value="u.role"
                    size="small"
                    :options="roleOptions"
                  />
                </td>
                <td>
                  <n-button size="tiny" @click="userRows.splice(i, 1)">
                    删除
                  </n-button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="user-actions">
          <n-button size="small" @click="addUser">新增用户</n-button>
          <n-button
            size="small"
            type="primary"
            :loading="savingUsers"
            @click="saveUserRows"
          >
            保存用户
          </n-button>
        </div>
      </n-modal>

      <div class="section-head">
        <h3>文件状态</h3>
        <div v-if="selectedCount" class="batch-actions">
          <n-button
            size="small"
            type="primary"
            :loading="batchSaving"
            @click="batchSave"
          >
            批量保存({{ selectedCount }})
          </n-button>
          <n-button
            size="small"
            type="warning"
            :loading="batching"
            @click="batchArchive"
          >
            批量过时存档({{ selectedCount }})
          </n-button>
        </div>
      </div>
      <doc-filters
        v-slot="{ rows: filteredRows }"
        :docs="docs"
        :archived-numbers="archived"
      >
        <div v-if="filteredRows.length" class="table-scroll">
          <table class="grid docs">
            <thead>
              <tr>
                <th class="pick-col">
                  <n-checkbox
                    :checked="areAllSelectableSelected(filteredRows)"
                    @update:checked="(v: boolean) => toggleAll(v, filteredRows)"
                  />
                </th>
                <th>剧情</th>
                <th>译者</th>
                <th>翻译状态</th>
                <th>校对者</th>
                <th>校对状态</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="d in filteredRows" :key="d.number">
                <td class="pick-col">
                  <n-checkbox
                    :checked="selected.has(d.number)"
                    :disabled="isArchived(d)"
                    @update:checked="(v: boolean) => toggleSelected(d.number, v)"
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
                      size="small"
                      type="primary"
                      :loading="busy === d.number"
                      @click="saveDoc(d)"
                    >
                      保存
                    </n-button>
                    <n-button
                      v-if="isArchived(d)"
                      size="small"
                      type="success"
                      :loading="busy === d.number"
                      @click="restore(d)"
                    >
                      恢复
                    </n-button>
                    <n-button
                      v-else
                      size="small"
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
        </div>
        <n-empty
          v-else-if="!loading"
          :description="docs.length ? '没有符合筛选条件的文件' : '暂无文件'"
        />
      </doc-filters>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onActivated, onMounted, ref, watch } from 'vue'
import {
  NAlert,
  NButton,
  NCheckbox,
  NEmpty,
  NInput,
  NModal,
  NSelect,
} from 'naive-ui'
import PushHeader from '../translate/push/PushHeader.vue'
import DocFilters from './DocFilters.vue'
import { store } from '../../store'
import {
  users,
  displayUser,
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
  id: string
  github: string
  role: UserRole
  qq: string
}

const loading = ref(false)
const savingUsers = ref(false)
const savingMe = ref(false)
const batching = ref(false)
const batchSaving = ref(false)
const uploading = ref(false)
const busy = ref<number | null>(null)
const showUsers = ref(false)
const userError = ref('')
const error = ref('')
const docs = ref<DocTask[]>([])
const archived = ref<Set<number>>(new Set())
const selected = ref<Set<number>>(new Set())
const userRows = ref<UserRow[]>([])
const myName = ref('')
const uploadFile = ref<File | null>(null)
const uploadTitle = ref('')
const uploadStage = ref<'ai' | 'translated' | 'proofread'>('ai')
let lastRefreshAt = 0

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
  ...Object.entries(users)
    .map(([id, u]) => ({
      label: `${id} (${u.github ? `GitHub: ${u.github}` : `QQ: ${u.qq}`})`,
      value: u.github || (u.qq ? `qq-${u.qq}` : ''),
    }))
    .filter((option) => option.value),
])

function syncUserRows() {
  userRows.value = Object.entries(users)
    .map(([id, u]) => ({
      id,
      github: u.github || '',
      role: u.role,
      qq: u.qq || '',
    }))
    .sort((a, b) => a.id.localeCompare(b.id))
  myName.value = displayUser(me.value)
}

function addUser() {
  userRows.value.push({ id: '', github: '', role: 'user', qq: '' })
}

function isArchived(d: DocTask) {
  return archived.value.has(d.number)
}

function toggleSelected(n: number, v: boolean) {
  const next = new Set(selected.value)
  v ? next.add(n) : next.delete(n)
  selected.value = next
}
function areAllSelectableSelected(visible: DocTask[]) {
  const selectable = visible.filter((d) => !isArchived(d))
  return (
    selectable.length > 0 &&
    selectable.every((d) => selected.value.has(d.number))
  )
}
function toggleAll(v: boolean, visible: DocTask[]) {
  const next = new Set(selected.value)
  visible
    .filter((d) => !isArchived(d))
    .forEach((d) => (v ? next.add(d.number) : next.delete(d.number)))
  selected.value = next
}

async function refresh() {
  if (!store.octokitWrapper) return
  if (loading.value) return
  loading.value = true
  error.value = ''
  try {
    const [, issues] = await Promise.all([
      loadUsers(store.octokitWrapper),
      store.octokitWrapper.listIssues(WORK_OWNER, WORK_REPO, { state: 'all' }),
    ])
    syncUserRows()
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
    lastRefreshAt = Date.now()
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
  const githubIds = new Set<string>()
  const qqIds = new Set<string>()
  for (const [index, u] of userRows.value.entries()) {
    const id = u.id.trim()
    const github = u.github.trim()
    const qq = u.qq.trim()
    const row = `第 ${index + 1} 行`
    if (!id) return void (userError.value = `${row}缺少个人 ID`)
    if (!github && !qq)
      return void (userError.value = `${row}至少填写 GitHub ID 或 QQ 号`)
    if (qq && !/^\d+$/.test(qq))
      return void (userError.value = `${row}的 QQ 号只能包含数字`)
    if (next[id]) return void (userError.value = `个人 ID 重复：${id}`)
    const githubKey = github.toLocaleLowerCase()
    if (github && githubIds.has(githubKey))
      return void (userError.value = `GitHub ID 重复：${github}`)
    if (qq && qqIds.has(qq)) return void (userError.value = `QQ 号重复：${qq}`)
    if (github) githubIds.add(githubKey)
    if (qq) qqIds.add(qq)
    next[id] = { github, role: u.role, qq }
  }
  userError.value = ''
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

async function batchSave() {
  if (!store.octokitWrapper) return
  const picked = docs.value.filter((d) => selected.value.has(d.number))
  if (!picked.length) return
  batchSaving.value = true
  try {
    for (const d of picked)
      await updateTracks(store.octokitWrapper, d.number, d.tr, d.pr)
    await refresh()
  } catch (e: any) {
    alert(`批量保存失败：${e?.message || e}`)
  }
  batchSaving.value = false
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
onActivated(() => {
  if (store.octokitWrapper?.userMeta && Date.now() - lastRefreshAt > 30_000) refresh()
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
  color: #64748b;
}
.toolbar,
.profile,
.upload,
.user-actions,
.section-head,
.batch-actions,
.actions {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
}
.toolbar {
  margin: 10px 0;
}
h3 {
  margin: 18px 0 8px;
  font-size: 16px;
}
.user-actions {
  margin-bottom: 10px;
}
.user-rule {
  margin-bottom: 8px;
}
.section-head {
  justify-content: space-between;
  margin-top: 18px;
  gap: 12px;
}
.section-head h3 {
  margin: 0 0 8px;
}
.batch-actions {
  margin-bottom: 8px;
}
.table-scroll {
  overflow-x: auto;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.82);
  margin-bottom: 8px;
}
.grid {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
}
.grid th,
.grid td {
  border-bottom: 1px solid #e2e8f0;
  padding: 7px 6px;
  text-align: left;
}
.grid tbody tr:last-child td {
  border-bottom: 0;
}
.grid th {
  color: #64748b;
  font-weight: 500;
  font-size: 13px;
  background: #f8fafc;
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
  width: 34px;
  text-align: center;
}
.users th:nth-child(1) {
  width: 22%;
}
.users th:nth-child(2) {
  width: 25%;
}
.users {
  min-width: 560px;
}
.docs {
  min-width: 980px;
}
.users th:nth-child(3) {
  width: 22%;
}
.users th:nth-child(4) {
  width: 15%;
}
.users th:nth-child(5) {
  width: 8%;
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
  width: 190px;
}
.docs th:nth-child(7),
.docs td:nth-child(7) {
  text-align: center;
}
.docs .actions {
  justify-content: center;
  flex-wrap: nowrap;
}
.docs .actions :deep(.n-button) {
  min-width: 70px;
  height: 30px;
  padding: 0 10px;
}
.docs .actions :deep(.n-button__content) {
  white-space: nowrap;
}
.title {
  word-break: break-all;
  font-weight: 600;
}

@media (max-width: 720px) {
  .profile,
  .upload,
  .section-head,
  .batch-actions {
    align-items: stretch;
  }

  .profile .n-input,
  .upload .n-input,
  .upload .n-select {
    max-width: none;
    width: 100%;
  }

  .profile :deep(.n-button),
  .upload :deep(.n-button),
  .user-actions :deep(.n-button),
  .batch-actions :deep(.n-button) {
    min-height: 36px;
  }

  .section-head {
    display: block;
  }

  .users {
    min-width: 520px;
  }

  .docs {
    min-width: 860px;
  }
}
</style>
