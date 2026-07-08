<!-- DirectPush.vue —— 直推模型：把当前译文写回它被读取的那个 github 路径（同 owner/repo/branch/path），不 fork、不建分支、不走 PR。需对目标仓库有写权限（collaborator）。 -->
<template>
  <div class="direct-push">
    <n-alert v-if="!target" type="warning" :bordered="false">
      当前文件不是从仓库打开的，无法直接提交。请从工作仓库的剧情链接进入。
    </n-alert>
    <template v-else>
      <n-alert type="info" :bordered="false" class="target-info">
        提交到：<b>{{ target.owner }}/{{ target.repo }}</b>
        @ <b>{{ target.branch }}</b>
        <br />
        <span class="path">{{ target.path }}</span>
      </n-alert>

      <n-alert v-if="status.blocked" type="warning" :bordered="false">
        {{ status.blockMsg }}
      </n-alert>

      <n-input
        v-model:value="message"
        type="textarea"
        placeholder="提交说明（可留空用默认）"
        :disabled="isPushing || status.blocked"
        :autosize="{ minRows: 1, maxRows: 3 }"
      />
      <n-popconfirm
        positive-text="确认"
        negative-text="取消"
        @positive-click="push"
      >
        <template #trigger>
          <n-button
            type="primary"
            :disabled="isPushing || !store.base64content || status.blocked"
          >
            {{ isPushing ? '提交中…' : '提交到仓库' }}
          </n-button>
        </template>
        <span>将直接提交到 {{ target.branch }} 分支，确认？</span>
      </n-popconfirm>
      <div v-if="commitUrl" class="commit-result">
        <a :href="commitUrl" target="_blank">已提交，查看 commit ↗</a>
      </div>
    </template>

    <div v-if="status.activeRole" class="complete">
      <span class="tip">本篇全部保存后，点此完成：</span>
      <n-button size="small" type="success" @click="complete(status.activeRole!)">
        {{ TRACK_LABEL[status.activeRole] }}完成
      </n-button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import { NButton, NInput, NPopconfirm, NAlert } from 'naive-ui'
import { store } from '../../../store'
import { parseGithubBlobUrl } from '../../../helper/path'
import {
  WORK_OWNER,
  WORK_REPO,
  TRACK_LABEL,
  parseTrack,
  applyTrack,
  myStatusOf,
  type MyStatus,
  type TrackKey,
} from '../../../helper/workflow'

const route = useRoute()
const isPushing = ref(false)
const commitUrl = ref('')
const message = ref('')

const me = computed(() => store.octokitWrapper?.userMeta?.username || '')
const issueNumber = computed(() => {
  const n = Number(route.query.issue)
  return route.query.issue && !isNaN(n) ? n : null
})

// 我在本篇的状态：当前可完成的轨（单个），及校对被"翻译未完成"挡住的情况
const status = ref<MyStatus>({ activeRole: null, blocked: false, blockMsg: '' })
async function loadStatus() {
  status.value = { activeRole: null, blocked: false, blockMsg: '' }
  if (!issueNumber.value || !store.octokitWrapper?.userMeta) return
  try {
    const issue = await store.octokitWrapper.getIssue(
      WORK_OWNER,
      WORK_REPO,
      issueNumber.value
    )
    status.value = myStatusOf(
      parseTrack(issue.body, 'tr'),
      parseTrack(issue.body, 'pr'),
      me.value
    )
  } catch {
    /* 未登录/无 issue 时静默 */
  }
}
async function complete(k: TrackKey) {
  if (!issueNumber.value || !store.octokitWrapper) return
  try {
    await applyTrack(store.octokitWrapper, issueNumber.value, k, {
      user: me.value,
      state: '完成',
    })
    await loadStatus()
    alert(`${TRACK_LABEL[k]}已标记完成`)
  } catch (e: any) {
    alert(e?.message || e)
  }
}
onMounted(loadStatus)
watch([issueNumber, me], loadStatus)

const target = computed(() => {
  if (!store.sourceUrl) return null
  try {
    return parseGithubBlobUrl(store.sourceUrl)
  } catch {
    return null
  }
})

async function push() {
  if (!target.value) return
  if (!store.octokitWrapper?.userMeta) {
    alert('未登录')
    return
  }
  if (!store.base64content) {
    alert('内容为空')
    return
  }
  const { owner, repo, branch, path } = target.value
  const msg = message.value || `更新翻译 ${path}`
  isPushing.value = true
  try {
    const result = await store.octokitWrapper.updateContent(
      owner,
      repo,
      branch,
      path,
      msg,
      store.base64content
    )
    // @ts-ignore
    commitUrl.value = result.commit?.html_url || ''
  } catch (e) {
    alert(e)
    console.error(e)
  }
  isPushing.value = false
}
</script>

<style scoped>
.direct-push {
  display: flex;
  flex-direction: column;
  gap: 10px;
  text-align: left;
}
.target-info .path {
  word-break: break-all;
  color: #666;
}
.commit-result a {
  color: blue;
}
</style>
