// 工作仓库体检：身份形式、时间戳、Issue↔记录一致性、产物存在性、清单覆盖、数量与指纹。
// 只读，不写任何东西。跑法：npm run audit:work
// 依赖 gh CLI（已登录且对工作仓库有读权限）。
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'

const REPO = process.env.WORK_REPO || 'chihya72/gakumas-translation-work'
const BRANCH = process.env.WORK_BRANCH || 'main'
const RAW = `https://raw.githubusercontent.com/${REPO}/${BRANCH}/`

const gh = (args) =>
  execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 1 << 28 })
const api = (path) => JSON.parse(gh(['api', path]))

const TR = /<!--\s*tr:([^:>]*):([^>]*?)-->/
const PR = /<!--\s*pr:([^:>]*):([^>]*?)-->/
const pathMarker = (key) => new RegExp(`<!--\\s*${key}:\\s*([^\\s>]+)\\s*-->`)
const STRICT_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/

const grab = (body, re) => {
  const m = String(body || '').match(re)
  return m ? m.slice(1).map((x) => x.trim()) : null
}
const normTime = (t) => {
  const ms = Date.parse(t || '')
  return Number.isNaN(ms)
    ? ''
    : new Date(ms).toISOString().replace(/\.\d+Z$/, 'Z')
}

const problems = {}
const add = (kind, detail) => (problems[kind] ||= []).push(detail)

const head = api(`repos/${REPO}/git/ref/heads/${BRANCH}`).object.sha
const tree = new Set(
  api(`repos/${REPO}/git/trees/${head}?recursive=1`)
    .tree.filter((e) => e.type === 'blob')
    .map((e) => e.path)
)
const issues = JSON.parse(
  gh([
    'issue',
    'list',
    '-R',
    REPO,
    '--state',
    'all',
    '--limit',
    '1000',
    '--json',
    'number,title,body',
  ])
)
const users = JSON.parse(
  Buffer.from(
    api(`repos/${REPO}/contents/users.json`).content,
    'base64'
  ).toString('utf8')
)
let sourceTimes = {}
try {
  sourceTimes = JSON.parse(
    Buffer.from(
      api(`repos/${REPO}/contents/source_times.json`).content,
      'base64'
    ).toString('utf8')
  )
} catch {
  add('入库时间清单缺失', 'source_times.json 不存在')
}

const personIds = new Set(Object.keys(users))
const logins = new Set(
  Object.values(users)
    .map((u) => (u.github || '').toLowerCase())
    .filter(Boolean)
)
const qqs = new Set(Object.values(users).map((u) => u.qq).filter(Boolean))

const idForms = {}
const rows = []

for (let i = 0; i < issues.length; i += 25) {
  await Promise.all(
    issues.slice(i, i + 25).map(async (issue) => {
      const title = issue.title

      // 轨道身份形式：只该是 GitHub login 或 qq-<已登记号>
      for (const [key, re] of [
        ['tr', TR],
        ['pr', PR],
      ]) {
        const g = grab(issue.body, re)
        if (!g?.[0]) continue
        const u = g[0]
        const form = /^qq-\d+$/.test(u)
          ? qqs.has(u.slice(3))
            ? 'qq-号'
            : 'qq-号(未登记)'
          : logins.has(u.toLowerCase())
            ? 'GitHub login'
            : personIds.has(u)
              ? '个人ID(违规)'
              : '未知(违规)'
        idForms[form] = (idForms[form] || 0) + 1
        if (form.includes('违规')) add('身份形式违规', `${title} ${key}=${u}`)
      }

      if (!sourceTimes[title]) add('入库时间清单缺项', title)

      const res = await fetch(`${RAW}records/${title}.json?v=${Date.now()}`)
      if (!res.ok) return add('缺记录', title)
      const rec = await res.json()

      for (const [key, field, artifact, marker] of [
        ['tr', 'translation', 'translation_csv', 'translated_path'],
        ['pr', 'proofread', 'proofread_csv', 'proofread_path'],
      ]) {
        const g = grab(issue.body, key === 'tr' ? TR : PR) || ['', '']
        const track = rec[field] || {}
        // Issue 里的空状态由 parseTrack 归一成「待认领」，这里保持一致
        const issueState = g[1] || '待认领'
        if ((track.state || '') !== issueState)
          add(
            '状态不一致',
            `${title} ${key}: issue=${issueState} record=${track.state}`
          )

        const ts = track.timestamp || ''
        if (!ts) add('缺时间戳', `${title} ${key}`)
        else if (!STRICT_TIME.test(ts)) add('时间戳格式', `${title} ${key} ${ts}`)
        else if (Date.parse(ts) > Date.now() + 60_000)
          add('未来时间', `${title} ${key} ${ts}`)

        if (track.state === '完成') {
          const p = (grab(issue.body, pathMarker(marker)) || [''])[0]
          if (p && !tree.has(p)) add('完成但缺产物', `${title} ${p}`)
        }
        const declared = rec.artifacts?.[artifact]?.path || ''
        if (declared.startsWith('resources/'))
          add('记录里残留本地路径', `${title} ${declared}`)
      }

      const trAt = Date.parse(rec.translation?.timestamp || '')
      const prAt = Date.parse(rec.proofread?.timestamp || '')
      if (
        rec.translation?.state === '完成' &&
        rec.proofread?.state === '完成' &&
        prAt < trAt - 60_000
      )
        add('校对早于翻译', title)

      rows.push(
        [
          rec.file_id,
          rec.translation?.state || '',
          rec.translation?.display_id || '',
          normTime(rec.translation?.timestamp),
          rec.proofread?.state || '',
          rec.proofread?.display_id || '',
          normTime(rec.proofread?.timestamp),
        ].join('|')
      )
    })
  )
}

const count = (prefix) => [...tree].filter((p) => p.startsWith(prefix)).length
const mirror =
  count('raw_txt/') +
  count('ai_csv/') +
  count('translated_csv/') +
  count('proofread_csv/')

rows.sort()
console.log(`HEAD ${head}`)
console.log(`Issue ${issues.length} 个 / 记录 ${rows.length} 条\n`)
console.log('轨道身份形式:', JSON.stringify(idForms))
console.log(
  `正式镜像: raw_txt ${count('raw_txt/')} + ai ${count('ai_csv/')} + translated ${count('translated_csv/')} + proofread ${count('proofread_csv/')} = ${mirror}`
)
console.log(
  `镜像外: 草稿 ${count('translated_draft/') + count('proofread_draft/')} · 备份 ${count('translated_backup/') + count('proofread_backup/')} · 校对TXT ${count('proofread_txt/')}`
)
console.log(`入库时间清单: ${Object.keys(sourceTimes).length} 条`)
console.log(
  '记录指纹:',
  createHash('md5').update(rows.join('\n')).digest('hex'),
  '（与 NAS 侧同算法结果比对，相等即两端逐字段一致）'
)

const CHECKS = [
  '身份形式违规',
  '缺记录',
  '入库时间清单缺失',
  '入库时间清单缺项',
  '状态不一致',
  '缺时间戳',
  '时间戳格式',
  '未来时间',
  '完成但缺产物',
  '记录里残留本地路径',
  '校对早于翻译',
]
console.log('\n--- 检查项 ---')
let bad = 0
for (const kind of CHECKS) {
  const list = problems[kind] || []
  bad += list.length
  console.log(`${list.length ? '⚠ ' : '  '}${kind}: ${list.length}`)
  list.slice(0, 5).forEach((x) => console.log('      ' + x))
  if (list.length > 5) console.log(`      …另有 ${list.length - 5} 条`)
}
console.log(bad ? `\n共 ${bad} 项异常` : '\n无异常')
process.exit(bad ? 1 : 0)
