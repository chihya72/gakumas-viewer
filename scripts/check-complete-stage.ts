// completeStage 实跑检查：假 wrapper 记录提交了哪些文件，不碰网络。
// 跑法：npm run check:stage
import { completeStage, StaleRevisionError } from '../src/helper/workflow'

const b64 = (s) => Buffer.from(s, 'utf8').toString('base64')
const un = (s) => Buffer.from(s, 'base64').toString('utf8')

const CSV = 'id,name,text,trans\r\n0001,咲季,あ,啊\r\ninfo,x.txt,,\r\n译者,,,'

function makeWrapper({ record, existingOutput }) {
  const commits = []
  return {
    commits,
    headers: {},
    async getContent(owner, repo, branch, path) {
      if (path.startsWith('records/')) {
        if (!record) throw { response: { status: 404 } }
        return { content: b64(JSON.stringify(record)) }
      }
      if (path === 'users.json')
        return { content: b64(JSON.stringify({ 悸动: { github: 'kkdou3', qq: '' } })) }
      if (existingOutput && path === existingOutput.path)
        return { content: b64(existingOutput.text) }
      throw { response: { status: 404 } }
    },
    async commitFiles(owner, repo, branch, message, files) {
      commits.push({ message, files })
      return 'fakesha'
    },
  }
}

globalThis.fetch = async () => ({ ok: false })
globalThis.localStorage = {
  getItem: () => null,
  setItem: () => {},
}

const base = {
  fileId: 'adv_dear_hume_099',
  sourcePath: 'translated_csv/adv/dear/hume/099.csv',
  contentB64: b64(CSV),
  operatorGithub: 'kkdou3',
  translatorDisplay: '悸动',
}

let fail = 0
const check = (name, cond, extra = '') => {
  if (!cond) fail++
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${extra ? '  ' + extra : ''}`)
}

// 1) 版本一致 → 正常提交
{
  const w = makeWrapper({ record: { translation: { revision: 3 }, proofread: {} } })
  const r = await completeStage(w, { ...base, role: 'tr', baseRevision: 3 })
  const files = w.commits[0].files.map((f) => f.path)
  check('版本一致可提交', w.commits.length === 1)
  check('一次提交包含正式稿与记录', files.includes(base.sourcePath) && files.includes('records/adv_dear_hume_099.json'), JSON.stringify(files))
  const rec = JSON.parse(un(w.commits[0].files.find((f) => f.path.endsWith('.json')).content))
  check('revision 递增 3→4', rec.translation.revision === 4, String(rec.translation.revision))
  check('记录写入操作者', rec.translation.display_id === '悸动')
  check('时间戳为秒级 Z', /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(rec.translation.timestamp), rec.translation.timestamp)
  const out = un(w.commits[0].files.find((f) => f.path === base.sourcePath).content)
  check('署名行已写入', out.trim().endsWith('译者,悸动,,'), JSON.stringify(out.slice(-14)))
}

// 2) 版本落后 → 拒绝，且不提交任何内容
{
  const w = makeWrapper({ record: { translation: { revision: 5 }, proofread: {} } })
  let err = null
  try {
    await completeStage(w, { ...base, role: 'tr', baseRevision: 3 })
  } catch (e) {
    err = e
  }
  check('旧稿被拒绝', err instanceof StaleRevisionError)
  check('拒绝时未产生提交', w.commits.length === 0)
  check('提示含两个版本号', /第 3 版/.test(err?.message || '') && /第 5 版/.test(err?.message || ''))
}

// 3) baseRevision = -1 → 跳过校验
{
  const w = makeWrapper({ record: { translation: { revision: 9 }, proofread: {} } })
  await completeStage(w, { ...base, role: 'tr', baseRevision: -1 })
  check('-1 跳过 CAS', w.commits.length === 1)
}

// 4) 已有正式稿且内容不同 → 轮换出备份
{
  const w = makeWrapper({
    record: { translation: { revision: 1 }, proofread: {} },
    existingOutput: { path: base.sourcePath, text: '旧的正式稿内容' },
  })
  await completeStage(w, { ...base, role: 'tr', baseRevision: 1 })
  const files = w.commits[0].files.map((f) => f.path)
  check('旧稿轮换为备份', files.includes('translated_backup/adv/dear/hume/099.csv'), JSON.stringify(files))
  const backup = w.commits[0].files.find((f) => f.path.includes('_backup'))
  check('备份内容是旧稿', un(backup.content) === '旧的正式稿内容')
}

// 5) 内容与现有正式稿完全相同 → 不产生备份
{
  const stampedSame = CSV.replace('译者,,,', '译者,悸动,,')
  const w = makeWrapper({
    record: { translation: { revision: 1 }, proofread: {} },
    existingOutput: { path: base.sourcePath, text: stampedSame },
  })
  await completeStage(w, { ...base, role: 'tr', baseRevision: 1 })
  const files = w.commits[0].files.map((f) => f.path)
  check('内容未变不留备份', !files.some((p) => p.includes('_backup')), JSON.stringify(files))
}

// 6) 直接校对 → 翻译轨同步一份
{
  const w = makeWrapper({
    record: { translation: { revision: 0 }, proofread: { revision: 0 }, direct_machine_proofread: true },
  })
  const r = await completeStage(w, {
    ...base,
    role: 'pr',
    sourcePath: 'proofread_csv/adv/dear/hume/099.csv',
    baseRevision: 0,
  })
  const files = w.commits[0].files.map((f) => f.path)
  check('直接校对返回 true', r.directProofread === true)
  check('同步写入翻译稿', files.includes('translated_csv/adv/dear/hume/099.csv'), JSON.stringify(files))
}

// 7) 记录不存在 → 用空骨架，不炸
{
  const w = makeWrapper({ record: null })
  await completeStage(w, { ...base, role: 'tr', baseRevision: 0 })
  const rec = JSON.parse(un(w.commits[0].files.find((f) => f.path.endsWith('.json')).content))
  check('缺记录时新建骨架', rec.file_id === 'adv_dear_hume_099' && rec.category === 'dear', rec.category)
}

console.log(fail ? `\n${fail} 个用例失败` : '\n全部通过')
process.exit(fail ? 1 : 0)
