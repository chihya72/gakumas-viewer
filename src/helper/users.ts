import { reactive } from 'vue'
import {
  setAssigneeUsers,
  WORK_BRANCH,
  WORK_OWNER,
  WORK_REPO,
} from './workflow'

export type UserRole = 'user' | 'admin'
export interface WorkUser {
  role: UserRole
  github?: string
  qq?: string
}

export const users = reactive<Record<string, WorkUser>>({
  pm: { github: 'chihya72', role: 'admin' },
})
setAssigneeUsers(users)

function b64DecodeUtf8(b64: string): string {
  const bin = atob(b64.replace(/\n/g, ''))
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

function b64EncodeUtf8(str: string): string {
  const bytes = new TextEncoder().encode(str)
  let bin = ''
  bytes.forEach((b) => (bin += String.fromCharCode(b)))
  return btoa(bin)
}

function normalizeUsers(value: any): Record<string, WorkUser> {
  const result: Record<string, WorkUser> = {}
  Object.entries(value || {}).forEach(([key, raw]: [string, any]) => {
    const legacy = raw?.github === undefined
    const id = String(legacy ? raw?.name || key : key).trim()
    const github = String(
      legacy ? (key.startsWith('qq-') ? '' : key) : raw?.github || ''
    ).trim()
    const qq = String(raw?.qq || '').trim()
    if (!id || (!github && !qq)) return
    if (result[id]) throw new Error(`个人 ID 重复：${id}`)
    result[id] = {
      role: raw?.role === 'admin' ? 'admin' : 'user',
      github,
      qq,
    }
  })
  return result
}

export async function loadUsers(wrapper: any, bustCache = false) {
  try {
    const data = await wrapper.getContent(
      WORK_OWNER,
      WORK_REPO,
      WORK_BRANCH,
      'users.json',
      bustCache
    )
    const next = normalizeUsers(JSON.parse(b64DecodeUtf8(data.content)))
    Object.keys(users).forEach((key) => delete users[key])
    Object.assign(users, next)
  } catch (e: any) {
    if (e?.response?.status !== 404) throw e
  }
}

export async function saveUsers(wrapper: any, next: Record<string, WorkUser>) {
  await wrapper.updateContent(
    WORK_OWNER,
    WORK_REPO,
    WORK_BRANCH,
    'users.json',
    'update users',
    b64EncodeUtf8(JSON.stringify(next, null, 2))
  )
  Object.keys(users).forEach((k) => delete users[k])
  Object.assign(users, next)
}

export async function saveMyName(wrapper: any, github: string, name: string) {
  await loadUsers(wrapper)
  const current = Object.entries(users).find(
    ([, user]) => user.github?.toLocaleLowerCase() === github.toLocaleLowerCase()
  )
  const id = name.trim() || github
  if (users[id] && current?.[0] !== id) throw new Error(`个人 ID 已存在：${id}`)
  const next = { ...users }
  if (current) delete next[current[0]]
  next[id] = {
    role: current?.[1].role || 'user',
    github,
    qq: current?.[1].qq || '',
  }
  await saveUsers(wrapper, next)
}

export function displayUser(user: string): string {
  const value = user.trim()
  // 空值不能参与匹配：只填 QQ 的成员 github 为空，会把"无人认领"认成他
  if (!value) return ''
  const qq = value.startsWith('qq-') ? value.slice(3) : ''
  return (
    Object.entries(users).find(
      ([, item]) =>
        (!!qq && item.qq === qq) ||
        (!!item.github &&
          item.github.toLocaleLowerCase() === value.toLocaleLowerCase())
    )?.[0] || value
  )
}

export function isAdmin(user: string): boolean {
  return Object.values(users).some(
    (item) =>
      item.role === 'admin' &&
      item.github?.toLocaleLowerCase() === user.toLocaleLowerCase()
  )
}
