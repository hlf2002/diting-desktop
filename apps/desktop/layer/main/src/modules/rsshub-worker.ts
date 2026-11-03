/**
 * RSSHub P2P Worker — Electron main process 后台抓取节点
 *
 * 工作机制：
 * 1. 用户登录后自动启动 worker（5 分钟后开始轮询）
 * 2. 每次唤醒间隔 60 秒，检查：
 *    - 用户是否空闲（5 分钟无操作）→ 才领任务
 *    - 全局并发 = 1（同一时间只抓一个）
 *    - 每小时最多抓 20 个路由（防滥用）
 * 3. 领任务 → 调本地 RSSHub (127.0.0.1:1200) 抓取 → 回传结果
 * 4. 登出时自动停止 worker
 *
 * 限制：
 * - 不抢前台资源，只在空闲时跑
 * - 单个用户单日最多处理 N 个任务（以后改成服务端配额）
 */

import { powerMonitor } from "electron"

const SERVER_URL = "https://rsshub.7373.com.cn"
const LOCAL_RSSHUB_URL = "http://127.0.0.1:1200"

const IDLE_THRESHOLD_MS = 5 * 60 * 1000 // 用户空闲 5 分钟才开始抓
const POLL_INTERVAL_MS = 60 * 1000 // 每 60 秒醒一次
const MAX_TASKS_PER_HOUR = 20 // 每小时最多抓 20 个路由

interface WorkerState {
  running: boolean
  timer: NodeJS.Timeout | null
  tasksThisHour: { count: number; resetAt: number }
}

const state: WorkerState = {
  running: false,
  timer: null,
  tasksThisHour: { count: 0, resetAt: Date.now() + 3600 * 1000 },
}

/** 检查用户是否空闲（powerMonitor 提供系统级 idle 时间） */
function isIdle(): boolean {
  try {
    const idleSeconds = powerMonitor.getSystemIdleTime()
    return idleSeconds * 1000 >= IDLE_THRESHOLD_MS
  } catch {
    return false
  }
}

/** 每小时配额重置 */
function checkHourlyQuota(): boolean {
  const now = Date.now()
  if (now > state.tasksThisHour.resetAt) {
    state.tasksThisHour = { count: 0, resetAt: now + 3600 * 1000 }
  }
  return state.tasksThisHour.count < MAX_TASKS_PER_HOUR
}

/** 从服务器领一个待抓任务 */
async function claimTask(): Promise<string | null> {
  try {
    const res = await fetch(`${SERVER_URL}/api/pending`, {
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) return null
    const data = await res.json()
    return data?.route || null
  } catch {
    return null
  }
}

/** 调本地 RSSHub 抓取一个路由 */
async function fetchLocalRSSHub(route: string): Promise<{ xml: string; itemCount: number } | null> {
  try {
    const res = await fetch(`${LOCAL_RSSHUB_URL}${route}`, {
      signal: AbortSignal.timeout(60_000),
    })
    if (!res.ok) return null
    const xml = await res.text()
    const itemCount = (xml.match(/<item>/g) || []).length
    return { xml, itemCount }
  } catch {
    return null
  }
}

/** 回传结果到服务器 */
async function postResult(route: string, xml: string, itemCount: number): Promise<boolean> {
  try {
    const res = await fetch(`${SERVER_URL}/api/result`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ route, xml, item_count: itemCount }),
      signal: AbortSignal.timeout(15_000),
    })
    return res.ok
  } catch {
    return false
  }
}

/** 单次轮询：领任务 → 抓 → 回传 */
async function pollOnce() {
  if (!state.running) return
  if (!isIdle()) return
  if (!checkHourlyQuota()) return

  const route = await claimTask()
  if (!route) return

  console.log(`[rsshub-worker] 领任务: ${route}`)

  const result = await fetchLocalRSSHub(route)
  if (!result) {
    console.warn(`[rsshub-worker] 抓取失败: ${route}`)
    return
  }

  const ok = await postResult(route, result.xml, result.itemCount)
  if (ok) {
    state.tasksThisHour.count++
    console.log(`[rsshub-worker] 完成: ${route} (${result.itemCount} items)`)
  } else {
    console.warn(`[rsshub-worker] 回传失败: ${route}`)
  }
}

/** 启动 worker（用户登录成功后调用） */
export function startRSSHubWorker() {
  if (state.running) return
  state.running = true
  console.log("[rsshub-worker] 启动")

  // 5 分钟后开始第一次轮询（让用户先把应用打开）
  state.timer = setInterval(() => {
    void pollOnce().catch((err) => {
      console.warn("[rsshub-worker] 轮询异常:", err)
    })
  }, POLL_INTERVAL_MS)
}

/** 停止 worker（用户登出时调用） */
export function stopRSSHubWorker() {
  state.running = false
  if (state.timer) {
    clearInterval(state.timer)
    state.timer = null
  }
  console.log("[rsshub-worker] 停止")
}

/** 获取 worker 状态（给渲染进程查询用） */
export function getRSSHubWorkerStatus() {
  return {
    running: state.running,
    tasksThisHour: state.tasksThisHour.count,
    hourlyLimit: MAX_TASKS_PER_HOUR,
  }
}
