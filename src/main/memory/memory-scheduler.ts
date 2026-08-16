import { enqueueLLMTask } from "../llm-queue"
import { runReflectionAndCompression } from "./memory-compressor"
import { entityGraph } from "./entity-graph"
import { memoryJudge } from "./memory-judge"
import { memoryManager } from "./memory-manager"
import { runResolverQueueOnce } from "./memory-resolver"
import { memoryStore } from "./memory-store"
import type { L1Profile, MemoryCandidate, MemoryJudgeTurn } from "./memory-types"

const MEMORY_JUDGE_INTERVAL = 6
const MEMORY_JUDGE_CONTEXT_TURNS = 8

export interface MemorySchedulerDeps {
  ingestEntity: (text: string) => void
  enqueueTask: <T>(label: string, task: () => Promise<T>) => Promise<T>
  judgeMemory: (turns: MemoryJudgeTurn[], conversationId: string) => Promise<MemoryCandidate[]>
  writeMemory: (candidates: MemoryCandidate[]) => Promise<void>
  getL1: () => Promise<L1Profile>
  replaceL1Field: (field: "roundCount", value: number) => Promise<void>
  runReflectionAndCompression: () => Promise<void>
  runResolverQueueOnce: () => Promise<unknown>
  runDecay: () => Promise<void>
}

/** L2 权重每日衰减：-1/天，与召回侧 updateL2RecallStats(+1/次) 对冲，构成「常 recalled 常新」的稳态 */
const DECAY_INTERVAL_MS = 24 * 60 * 60 * 1000
/** 首次衰减延迟：避开启动期（对账 / Obsidian watcher / 索引重建） */
const DECAY_INITIAL_DELAY_MS = 60 * 1000

export class MemoryScheduler {
  private recentTurns: Array<MemoryJudgeTurn & { seq: number }> = []
  private nextTurnSeq = 0
  private decayKickoff: ReturnType<typeof setTimeout> | null = null
  private decayTimer: ReturnType<typeof setInterval> | null = null

  constructor(private readonly deps: MemorySchedulerDeps) {}

  scheduleMemoryWrite(userInput: string, assistantReply: string): void {
    const seq = ++this.nextTurnSeq
    this.recentTurns.push({ seq, userInput, assistantReply })
    if (this.recentTurns.length > MEMORY_JUDGE_CONTEXT_TURNS * 2) {
      this.recentTurns = this.recentTurns.slice(-MEMORY_JUDGE_CONTEXT_TURNS * 2)
    }

    try {
      this.deps.ingestEntity(userInput)
      this.deps.ingestEntity(assistantReply)
    } catch (err) {
      console.warn("[Memory] 实体图谱提取失败:", err)
    }

    this.deps.enqueueTask("MemoryMaintenance", async () => {
      await this.runQueuedMemoryWrite(seq)
    }).catch((e) => {
      console.error("[Memory] 记忆写入失败，不影响主流程", e)
    })
  }

  private async runQueuedMemoryWrite(seq: number): Promise<void> {
    const l1 = await this.deps.getL1()
    const newCount = (l1.roundCount || 0) + 1

    if (newCount % MEMORY_JUDGE_INTERVAL === 0) {
      try {
        const turns = this.recentTurns
          .filter((turn) => turn.seq <= seq)
          .slice(-MEMORY_JUDGE_CONTEXT_TURNS)
          .map(({ userInput, assistantReply }) => ({ userInput, assistantReply }))
        const candidates = await this.deps.judgeMemory(turns, "default")

        if (candidates.length > 0) {
          await this.deps.writeMemory(candidates)
        }
      } catch (err) {
        console.error("[Memory] MemoryJudge/Manager 执行失败，本轮仍会计数", err)
      }
    }

    await this.deps.replaceL1Field("roundCount", newCount)

    if (newCount % 5 === 0) {
      try {
        await this.deps.runResolverQueueOnce()
      } catch (err) {
        console.warn("[Memory] Resolver 队列处理失败，不影响主流程", err)
      }
    }

    if (newCount % 20 === 0) {
      console.log("[Memory] 达到 20 轮，触发 Reflection + 记忆压缩")
      await this.deps.runReflectionAndCompression()
    }
  }

  /**
   * 启动 L2 权重每日衰减（时间驱动，与对话轮次解耦——长时间不聊天也应遗忘）。
   * 经 enqueueTask 走 MemoryMaintenance 队列，与 Judge/Compressor 串行执行，
   * 避免 decayL2Weights 的 load→modify→save 与其他写操作竞态丢失更新。
   */
  startDailyDecay(
    initialDelayMs = DECAY_INITIAL_DELAY_MS,
    intervalMs = DECAY_INTERVAL_MS,
  ): void {
    // 守卫必须同时覆盖 kickoff 延迟阶段与定时器阶段，否则启动窗口内重复调用会开出双定时器
    if (this.decayTimer !== null || this.decayKickoff !== null) return

    const tick = () => {
      this.deps.enqueueTask("MemoryMaintenance", () => this.deps.runDecay()).catch((err) => {
        console.warn("[Memory] L2 权重衰减失败，不影响主流程:", err)
      })
    }

    this.decayKickoff = setTimeout(() => {
      this.decayKickoff = null
      tick()
      this.decayTimer = setInterval(tick, intervalMs)
    }, initialDelayMs)
    this.decayKickoff.unref?.()
  }

  stopDailyDecay(): void {
    if (this.decayKickoff !== null) {
      clearTimeout(this.decayKickoff)
      this.decayKickoff = null
    }
    if (this.decayTimer !== null) {
      clearInterval(this.decayTimer)
      this.decayTimer = null
    }
  }
}

export const memoryScheduler = new MemoryScheduler({
  ingestEntity: (text) => entityGraph.ingest(text),
  enqueueTask: enqueueLLMTask,
  judgeMemory: (turns, conversationId) => memoryJudge.judgeRecentTurns(turns, conversationId),
  writeMemory: (candidates) => memoryManager.writeMemory(candidates),
  getL1: () => memoryStore.getL1(),
  replaceL1Field: (field, value) => memoryStore.replaceL1Field(field, value),
  runReflectionAndCompression,
  runResolverQueueOnce,
  runDecay: () => memoryManager.runDecay(),
})
