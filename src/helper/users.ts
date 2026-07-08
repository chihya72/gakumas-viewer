import { reactive } from 'vue'
import { WORK_BRANCH, WORK_OWNER, WORK_REPO } from './workflow'

export type UserRole = 'user' | 'admin'
export interface WorkUser {
  name: string
  role: UserRole
}

export const users = reactive<Record<string, WorkUser>>({
  chihya72: { name: 'pm', role: 'admin' },
})

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

export async function loadUsers(wrapper: any) {
  try {
    const data = await wrapper.getContent(
      WORK_OWNER,
      WORK_REPO,
      WORK_BRANCH,
      'users.json',
      true
    )
    Object.assign(users, JSON.parse(b64DecodeUtf8(data.content)))
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

export function displayUser(user: string): string {
  return users[user]?.name || user
}

export function isAdmin(user: string): boolean {
  return users[user]?.role === 'admin'
}
