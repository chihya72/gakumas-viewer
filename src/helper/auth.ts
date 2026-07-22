import axios from 'axios'
import { RequestInterface } from '@octokit/types'
// @ts-ignore
import { Octokit } from 'https://esm.sh/v122/@octokit/core@4.2.1'

const clientId =
  process.env.NODE_ENV === 'development'
    ? import.meta.env.VITE_DEV_CLIENT_ID
    : import.meta.env.VITE_CLIENT_ID

// this is a pure frontend application
// so it's ok to expose client secret
const clientSecret =
  process.env.NODE_ENV === 'development'
    ? import.meta.env.VITE_DEV_CLIENT_SECRET
    : import.meta.env.VITE_CLIENT_SECRET

// corredponding redirect uri of github oauth configuration
const HOSTNAME =
  process.env.NODE_ENV === 'development'
    ? import.meta.env.VITE_DEV_HOSTNAME
    : import.meta.env.VITE_HOSTNAME

// used to fetch access token
const GITHUB_PROXY = import.meta.env.VITE_GITHUB_PROXY
// used to proxy github rest api
const GITHUB_API_PROXY = import.meta.env.VITE_GITHUB_API_PROXY

// const defaultGithubProxy = 'https://strawberrytree.top'
const useGithubProxy = true
const cancelLoginUrl = `https://github.com/settings/connections/applications/${clientId}`
// ponytail: 硬编码为本汉化组自己的 fork（owner 就是本 fork 维护者）；上游是 imas-tools/gakuen-adapted-translation-data
const rootRepoName = 'gakuen-adapted-translation-data-pm'
const rootOwner = 'chihya72'
const rootBranch = 'main'

interface BranchComparison {
  aheadBy: number
  behindBy: number
  status: 'diverged' | 'ahead' | 'behind' | 'identical'
}

class OctokitWrapper {
  request: RequestInterface
  headers = {
    'X-GitHub-Api-Version': '2022-11-28',
  }
  userMeta: {
    username: string
    avatarUrl: string
  } | null = null

  constructor(accessToken: string, baseUrl = GITHUB_API_PROXY) {
    const octokit = new Octokit({
      auth: accessToken,
      baseUrl,
    })
    this.request = octokit.request
  }

  async updateUserMeta() {
    this.userMeta = await this.getUserMeta()
  }

  async getUserMeta() {
    const { data } = await this.request('GET /user', {
      headers: this.headers,
    })
    return {
      username: data.login,
      avatarUrl: data.avatar_url,
    }
  }

  // select information to use from data
  async getRepoMeta(owner: string, repo: string) {
    const { data } = await this.request('GET /repos/{owner}/{repo}', {
      owner,
      repo,
      headers: this.headers,
    })
    return data
  }

  async createFork(owner: string, repo: string) {
    const { data } = await this.request('POST /repos/{owner}/{repo}/forks', {
      owner,
      repo,
      default_branch_only: true,
      headers: this.headers,
    })
    return data
  }

  // TODO: return compared commits info (ahead)
  async getCompare(
    owner: string,
    repo: string,
    base: string,
    head: string
  ): Promise<BranchComparison> {
    const { data } = await this.request(
      'GET /repos/{owner}/{repo}/compare/{basehead}',
      {
        owner,
        repo,
        basehead: `${base}...${head}`,
        headers: this.headers,
      }
    )
    return {
      aheadBy: data.ahead_by,
      behindBy: data.behind_by,
      status: data.status,
    }
  }

  async listBrancheNames(owner: string, repo: string) {
    const { data } = await this.request('GET /repos/{owner}/{repo}/branches', {
      owner,
      repo,
      headers: this.headers,
    })
    return data.map((item) => item.name)
  }

  async syncBranch(owner: string, repo: string, branch: string) {
    const { data } = await this.request(
      'POST /repos/{owner}/{repo}/merge-upstream',
      {
        owner,
        repo,
        branch,
        headers: this.headers,
      }
    )
    return data
  }

  async createRef(
    owner: string,
    repo: string,
    branch: string,
    sourceOwner: string,
    sourceRepo: string,
    sourceBranch: string
  ) {
    const { data } = await this.request(
      'GET /repos/{owner}/{repo}/git/ref/{ref}',
      {
        owner: sourceOwner,
        repo: sourceRepo,
        ref: `heads/${sourceBranch}`,
        headers: this.headers,
      }
    )

    await this.request('POST /repos/{owner}/{repo}/git/refs', {
      owner,
      repo,
      ref: `refs/heads/${branch}`,
      sha: data['object'].sha,
      headers: this.headers,
    })
  }

  // to test
  async forceSyncRef(
    owner: string,
    repo: string,
    branch: string,
    sourceOwner: string,
    sourceRepo: string,
    sourceBranch: string
  ) {
    const { data } = await this.request(
      'GET /repos/{owner}/{repo}/git/ref/{ref}',
      {
        owner: sourceOwner,
        repo: sourceRepo,
        ref: `heads/${sourceBranch}`,
        headers: this.headers,
      }
    )

    await this.request('PATCH /repos/{owner}/{repo}/git/refs/{ref}', {
      owner,
      repo,
      ref: `refs/heads/${branch}`,
      sha: data['object'].sha,
      force: true,
      headers: this.headers,
    })
  }

  async getContent(
    owner: string,
    repo: string,
    branch: string,
    path: string,
    bustCache = false
  ) {
    const { data } = await this.request(
      'GET /repos/{owner}/{repo}/contents/{path}',
      {
        owner,
        repo,
        branch,
        path,
        // 破坏 API 代理缓存，确保拿到最新 sha（否则 PUT 会 409 sha 冲突）
        ...(bustCache ? { _cb: Date.now() } : {}),
        headers: this.headers,
      }
    )
    return data
  }

  async updateContent(
    owner: string,
    repo: string,
    branch: string,
    path: string,
    message: string,
    content: string
  ) {
    const freshSha = async (): Promise<string | undefined> => {
      try {
        const d = await this.getContent(owner, repo, branch, path, true)
        // @ts-ignore
        return d.sha
      } catch (e: any) {
        if (e?.response?.status === 404) return undefined // 文件不存在=新建
        throw e
      }
    }

    const put = async (useSha: string | undefined) => {
      const { data } = await this.request(
        'PUT /repos/{owner}/{repo}/contents/{path}',
        {
          owner,
          repo,
          branch,
          path,
          sha: useSha,
          message,
          content,
          headers: this.headers,
        }
      )
      return data
    }

    // 始终用最新 sha；万一仍冲突（代理缓存顽固），再取一次 sha 重试
    try {
      return await put(await freshSha())
    } catch (e: any) {
      return await put(await freshSha())
    }
  }

  // 多文件一次提交：blob → tree → commit → 非强制更新 ref。
  //
  // 读 HEAD 必须带 _cb 破坏 API 代理缓存：不加的话连续保存两次，第二次会读到
  // 上一次提交之前的 sha，拿过期父提交更新引用直接失败（与并发无关）。
  //
  // 分支真被推进时也不能直接失败——Bot 每 60 秒轮询就可能写记录，那样任何人在
  // 仓库任何角落提交一次都会让本次保存作废。只有当**我们要写的这些路径**也被
  // 别人改过时才算真冲突；否则在新 HEAD 上重建 tree 重试。
  // content 传 base64；content 为 null 表示删除该路径。
  // path 相同的以最后一个为准（tree 里不能有重复项）。
  async commitFiles(
    owner: string,
    repo: string,
    branch: string,
    message: string,
    files: { path: string; content: string | null }[],
    retriesLeft = 3
  ): Promise<string> {
    if (!files.length) throw new Error('没有要提交的文件')

    const { data: ref } = await this.request(
      'GET /repos/{owner}/{repo}/git/ref/{ref}',
      {
        owner,
        repo,
        ref: `heads/${branch}`,
        _cb: Date.now(),
        headers: this.headers,
      }
    )
    const headSha: string = ref.object.sha
    const { data: head } = await this.request(
      'GET /repos/{owner}/{repo}/git/commits/{commit_sha}',
      { owner, repo, commit_sha: headSha, headers: this.headers }
    )

    const unique = [...new Map(files.map((f) => [f.path, f])).values()]
    const blobs = await Promise.all(
      unique.map(async (f) => {
        // sha: null 是 Git Data API 表示「从树中删除」的写法
        if (f.content === null)
          return {
            path: f.path,
            mode: '100644' as const,
            type: 'blob' as const,
            sha: null,
          }
        const { data } = await this.request(
          'POST /repos/{owner}/{repo}/git/blobs',
          {
            owner,
            repo,
            content: f.content.replace(/\n/g, ''),
            encoding: 'base64',
            headers: this.headers,
          }
        )
        return {
          path: f.path,
          mode: '100644' as const,
          type: 'blob' as const,
          sha: data.sha as string | null,
        }
      })
    )

    const { data: tree } = await this.request(
      'POST /repos/{owner}/{repo}/git/trees',
      {
        owner,
        repo,
        base_tree: head.tree.sha,
        tree: blobs,
        headers: this.headers,
      }
    )
    const { data: commit } = await this.request(
      'POST /repos/{owner}/{repo}/git/commits',
      {
        owner,
        repo,
        message,
        tree: tree.sha,
        parents: [headSha],
        headers: this.headers,
      }
    )
    try {
      await this.request('PATCH /repos/{owner}/{repo}/git/refs/{ref}', {
        owner,
        repo,
        ref: `heads/${branch}`,
        sha: commit.sha,
        force: false,
        headers: this.headers,
      })
    } catch (e: any) {
      if (e?.response?.status !== 422 || retriesLeft <= 0) throw e
      // 分支动了：看动的是不是我们这几个路径
      const { data: newRef } = await this.request(
        'GET /repos/{owner}/{repo}/git/ref/{ref}',
        {
          owner,
          repo,
          ref: `heads/${branch}`,
          _cb: Date.now(),
          headers: this.headers,
        }
      )
      const { data: diff } = await this.request(
        'GET /repos/{owner}/{repo}/compare/{basehead}',
        {
          owner,
          repo,
          basehead: `${headSha}...${newRef.object.sha}`,
          headers: this.headers,
        }
      )
      const ours = new Set(unique.map((f) => f.path))
      const clash = (diff.files || [])
        .map((f: any) => f.filename)
        .filter((f: string) => ours.has(f))
      if (clash.length)
        throw new Error(
          '这些文件已被其他人改动，请刷新后重试：\n' +
            clash.slice(0, 5).join('\n')
        )
      return this.commitFiles(
        owner,
        repo,
        branch,
        message,
        files,
        retriesLeft - 1
      )
    }
    return commit.sha
  }

  async getOpenPR(owner: string, repo: string, head: string) {
    const { data } = await this.request('GET /repos/{owner}/{repo}/pulls', {
      owner,
      repo,
      state: 'open',
      head,
      headers: this.headers,
    })
    return data
  }

  async createPR(
    owner: string,
    repo: string,
    title: string,
    body: string,
    head: string,
    base: string
  ) {
    const { data } = await this.request('POST /repos/{owner}/{repo}/pulls', {
      owner,
      repo,
      title,
      body,
      head,
      base,
      headers: this.headers,
    })

    return data
  }

  async listIssues(
    owner: string,
    repo: string,
    params: {
      state?: 'open' | 'closed' | 'all'
      assignee?: string
      labels?: string
    } = {}
  ) {
    const out = []
    for (let page = 1; ; page++) {
      const { data } = await this.request('GET /repos/{owner}/{repo}/issues', {
        owner,
        repo,
        state: 'open',
        per_page: 100,
        page,
        ...params,
        headers: this.headers,
      })
      out.push(...data)
      if (data.length < 100) return out
    }
  }

  async getIssue(owner: string, repo: string, issue_number: number) {
    const { data } = await this.request(
      'GET /repos/{owner}/{repo}/issues/{issue_number}',
      { owner, repo, issue_number, headers: this.headers }
    )
    return data
  }

  // 认领/交活/改状态：body 存双轨标记，assignees 存认领人并集
  async updateIssue(
    owner: string,
    repo: string,
    issue_number: number,
    params: {
      body?: string
      labels?: string[]
      assignees?: string[]
      state?: 'open' | 'closed'
    }
  ) {
    const { data } = await this.request(
      'PATCH /repos/{owner}/{repo}/issues/{issue_number}',
      {
        owner,
        repo,
        issue_number,
        ...params,
        headers: this.headers,
      }
    )
    return data
  }
}

const endpoints = {
  accessToken: () => 'https://github.com/login/oauth/access_token',
}

function generateState() {
  return Math.floor(Math.random() * Date.now())
}

function generateAuthRequest(state: number) {
  if (location.hostname !== HOSTNAME) {
    alert(
      `Login is disabled in ${location.hostname}, please visit https://${HOSTNAME}`
    )
    throw new Error(`not supported domain: ${location.hostname}`)
  }
  return `https://github.com/login/oauth/authorize?client_id=${clientId}&scope=repo+read:user&state=${state}`
}

function proxiedGithubUrl(githubUrl: string, letPass = false) {
  if (!useGithubProxy) {
    return githubUrl
  }
  if (githubUrl.startsWith('https://github.com')) {
    return githubUrl.replace('https://github.com', GITHUB_PROXY)
  }
  if (!letPass) throw new Error(`Not a github url: ${githubUrl}`)
  return githubUrl
}

async function fetchAccessToken(code: string) {
  const endpointUrl = proxiedGithubUrl(endpoints.accessToken())
  const response = await axios.post(
    endpointUrl,
    {
      code,
      client_id: clientId,
      client_secret: clientSecret,
    },
    {
      headers: {
        Accept: 'application/json',
      },
    }
  )
  // console.log(response.data)
  return response.data.access_token
}

export {
  OctokitWrapper,
  generateState,
  generateAuthRequest,
  fetchAccessToken,
  rootRepoName,
  rootOwner,
  rootBranch,
}
export type { BranchComparison }
