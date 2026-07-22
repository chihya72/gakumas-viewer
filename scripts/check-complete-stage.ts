// completeStage 实跑检查：假 wrapper 记录提交了哪些文件，不碰网络。
// 跑法：npm run check:stage
import {
  completeStage,
  draftInfoOf,
  myStatusOf,
  sameWorkUser,
  saveDraft,
  setAssigneeUsers,
  StaleRevisionError,
} from '../src/helper/workflow'

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
        return {
          content: b64(JSON.stringify({ 悸动: { github: 'kkdou3', qq: '' } })),
        }
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
  setItem: () => undefined,
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
  const w = makeWrapper({
    record: { translation: { revision: 3 }, proofread: {} },
  })
  const r = await completeStage(w, { ...base, role: 'tr', baseRevision: 3 })
  const files = w.commits[0].files.map((f) => f.path)
  check('版本一致可提交', w.commits.length === 1)
  check(
    '一次提交包含正式稿与记录',
    files.includes(base.sourcePath) &&
      files.includes('records/adv_dear_hume_099.json'),
    JSON.stringify(files)
  )
  const rec = JSON.parse(
    un(w.commits[0].files.find((f) => f.path.endsWith('.json')).content)
  )
  check(
    'revision 递增 3→4',
    rec.translation.revision === 4,
    String(rec.translation.revision)
  )
  check('记录写入操作者', rec.translation.display_id === '悸动')
  check(
    '时间戳为秒级 Z',
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(rec.translation.timestamp),
    rec.translation.timestamp
  )
  const out = un(
    w.commits[0].files.find((f) => f.path === base.sourcePath).content
  )
  check(
    '署名行已写入',
    out.trim().endsWith('译者,悸动,,'),
    JSON.stringify(out.slice(-14))
  )
}

// 2) 版本落后 → 拒绝，且不提交任何内容
{
  const w = makeWrapper({
    record: { translation: { revision: 5 }, proofread: {} },
  })
  let err = null
  try {
    await completeStage(w, { ...base, role: 'tr', baseRevision: 3 })
  } catch (e) {
    err = e
  }
  check('旧稿被拒绝', err instanceof StaleRevisionError)
  check('拒绝时未产生提交', w.commits.length === 0)
  check(
    '提示含两个版本号',
    /第 3 版/.test(err?.message || '') && /第 5 版/.test(err?.message || '')
  )
}

// 3) baseRevision = -1 → 跳过校验
{
  const w = makeWrapper({
    record: { translation: { revision: 9 }, proofread: {} },
  })
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
  check(
    '旧稿轮换为备份',
    files.includes('translated_backup/adv/dear/hume/099.csv'),
    JSON.stringify(files)
  )
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
  check(
    '内容未变不留备份',
    !files.some((p) => p.includes('_backup')),
    JSON.stringify(files)
  )
}

// 6) 直接校对 → 翻译轨同步一份
{
  const w = makeWrapper({
    record: {
      translation: { revision: 0 },
      proofread: { revision: 0 },
      direct_machine_proofread: true,
    },
  })
  const r = await completeStage(w, {
    ...base,
    role: 'pr',
    sourcePath: 'proofread_csv/adv/dear/hume/099.csv',
    baseRevision: 0,
  })
  const files = w.commits[0].files.map((f) => f.path)
  check('直接校对返回 true', r.directProofread === true)
  check(
    '同步写入翻译稿',
    files.includes('translated_csv/adv/dear/hume/099.csv'),
    JSON.stringify(files)
  )
}

// 7) 记录不存在 → 用空骨架，不炸
{
  const w = makeWrapper({ record: null })
  await completeStage(w, { ...base, role: 'tr', baseRevision: 0 })
  const rec = JSON.parse(
    un(w.commits[0].files.find((f) => f.path.endsWith('.json')).content)
  )
  check(
    '缺记录时新建骨架',
    rec.file_id === 'adv_dear_hume_099' && rec.category === 'dear',
    rec.category
  )
}

// 8) 中途保存：只写草稿和记录，不碰正式稿与状态
{
  const w = makeWrapper({
    record: { translation: { revision: 2, state: '进行中' }, proofread: {} },
  })
  const r = await saveDraft(w, {
    fileId: base.fileId,
    role: 'tr',
    sourcePath: base.sourcePath,
    contentB64: base.contentB64,
    operatorGithub: 'kkdou3',
  })
  const files = w.commits[0].files.map((f) => f.path)
  check(
    '草稿写入 translated_draft',
    files.includes('translated_draft/adv/dear/hume/099.csv'),
    JSON.stringify(files)
  )
  check('不触碰正式稿', !files.includes(base.sourcePath))
  const rec = JSON.parse(
    un(w.commits[0].files.find((f) => f.path.endsWith('.json')).content)
  )
  check(
    '正式 revision 不变',
    rec.translation.revision === 2,
    String(rec.translation.revision)
  )
  check(
    '完成状态不变',
    rec.translation.state === '进行中',
    rec.translation.state
  )
  check('draft_revision 递增', rec.translation.draft_revision === 1)
  check('记下基准版本', rec.artifacts.translation_draft.based_on_revision === 2)
  check('返回值一致', r.draftRevision === 1 && r.baseRevision === 2)
}

// 9) 草稿新鲜度与归属判定
{
  const mk = (basedOn: number, revision: number, who: string) => ({
    translation: { revision },
    artifacts: {
      translation_draft: {
        path: 'p.csv',
        based_on_revision: basedOn,
        operator_github: who,
        display_id: who,
      },
    },
  })
  check(
    '同版本且本人 → 可恢复',
    (() => {
      const i = draftInfoOf(mk(2, 2, 'kkdou3'), 'tr', 'kkdou3')!
      return !i.stale && i.mine
    })()
  )
  check(
    '正式稿已推进 → 过期',
    draftInfoOf(mk(2, 3, 'kkdou3'), 'tr', 'kkdou3')!.stale
  )
  check(
    '他人草稿 → 非本人',
    !draftInfoOf(mk(2, 2, 'other'), 'tr', 'kkdou3')!.mine
  )
  check(
    '大小写不同的同一人',
    draftInfoOf(mk(2, 2, 'KKDou3'), 'tr', 'kkdou3')!.mine
  )
  check(
    '无草稿返回 null',
    draftInfoOf({ translation: { revision: 1 } }, 'tr', 'kkdou3') === null
  )
}

// 10) 完成时删除草稿并清空元信息
{
  const w = makeWrapper({
    record: {
      translation: { revision: 1, draft_revision: 3 },
      proofread: {},
      artifacts: {
        translation_draft: { path: 'translated_draft/adv/dear/hume/099.csv' },
      },
    },
  })
  await completeStage(w, { ...base, role: 'tr', baseRevision: 1 })
  const del = w.commits[0].files.find((f) => f.path.includes('_draft'))
  check('草稿被删除', del?.content === null, JSON.stringify(del))
  const rec = JSON.parse(
    un(
      w.commits[0].files.find((f) => f.path.endsWith('records/')) ??
        w.commits[0].files.find((f) => f.path.endsWith('.json')).content
    )
  )
  check('元信息已清除', rec.artifacts.translation_draft === undefined)
  check(
    'draft_revision 归零',
    rec.translation.draft_revision === 0,
    String(rec.translation.draft_revision)
  )
}

// 11) 身份归一：轨道存个人 ID，登录态是 GitHub login
{
  setAssigneeUsers({
    pm: { github: 'chihya72', qq: '' },
    煉金術式: { github: '', qq: '948279048' },
  })
  check('个人 ID 与 login 视为同一人', sameWorkUser('pm', 'chihya72'))
  check('反向也成立', sameWorkUser('chihya72', 'pm'))
  check('login 大小写不敏感', sameWorkUser('pm', 'CHIHYA72'))
  check('不同人不匹配', !sameWorkUser('pm', 'someone-else'))
  check(
    '空值不匹配任何人',
    !sameWorkUser('', 'chihya72') && !sameWorkUser('pm', '')
  )
  check('QQ-only 成员按个人 ID 匹配', sameWorkUser('煉金術式', '煉金術式'))
  check('空值不会命中 QQ-only 成员', !sameWorkUser('', '煉金術式'))

  const tr = { user: 'pm', state: '进行中' as const }
  const pr = { user: '', state: '待认领' as const }
  check(
    '我的进行中轨道可编辑',
    myStatusOf(tr, pr, 'chihya72').activeRole === 'tr'
  )
  check(
    '别人的进行中轨道不可编辑',
    myStatusOf(tr, pr, 'someone-else').activeRole === null
  )
}

console.log(fail ? `\n${fail} 个用例失败` : '\n全部通过')
process.exit(fail ? 1 : 0)
