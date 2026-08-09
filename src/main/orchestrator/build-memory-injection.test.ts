import { beforeEach, describe, expect, it, vi } from "vitest"
import { clearRecentMemoryInjections, wasRecentlyInjectedMemory } from "../memory/recent-injected-memory"

const ragMock = vi.hoisted(() => ({
  searchMemory: vi.fn(),
  searchMemoryEntries: vi.fn(),
  updateWorldbookActivation: vi.fn(),
  getPermanentWorldbookEntries: vi.fn(),
  getActiveWorldbookEntries: vi.fn(),
  getCascadeWorldbookEntries: vi.fn(),
  INJECTION_HEADER: "HEADER",
  INJECTION_PREAMBLE: "PREAMBLE",
}))

const memoryStoreMock = vi.hoisted(() => ({
  getAllL2: vi.fn(),
  getL0: vi.fn(),
  getL1: vi.fn(),
}))

const l2DmaeManagerMock = vi.hoisted(() => ({
  getActiveL2ForPrompt: vi.fn(),
}))

const entityGraphMock = vi.hoisted(() => ({
  search: vi.fn(),
}))

vi.mock("../rag", () => ragMock)
vi.mock("../memory/memory-store", () => ({ memoryStore: memoryStoreMock }))
vi.mock("../memory/l2-dmae-manager", () => ({ l2DmaeManager: l2DmaeManagerMock }))
vi.mock("../memory/entity-graph", () => ({ entityGraph: entityGraphMock }))
vi.mock("./tool-registry", () => ({ toolRegistry: { getEnabledTools: vi.fn(() => []) } }))

describe("buildMemoryInjection", () => {
  beforeEach(() => {
    clearRecentMemoryInjections()
    ragMock.searchMemory.mockReset()
    ragMock.searchMemoryEntries.mockReset()
    ragMock.searchMemory.mockResolvedValue([])
    ragMock.searchMemoryEntries.mockResolvedValue([])
    memoryStoreMock.getAllL2.mockReset()
    memoryStoreMock.getAllL2.mockResolvedValue([])
    l2DmaeManagerMock.getActiveL2ForPrompt.mockReset()
    l2DmaeManagerMock.getActiveL2ForPrompt.mockResolvedValue([])
    entityGraphMock.search.mockReset()
    entityGraphMock.search.mockReturnValue("")
  })

  it("records injected user memory l2 ids from RAG metadata", async () => {
    ragMock.searchMemoryEntries.mockResolvedValue([{
      id: "rag_run",
      text: "用户喜欢跑步",
      createdAt: Date.now(),
      score: 0.8,
      metadata: { l2Id: "l2_run" },
    }])
    const { buildMemoryInjection } = await import("./index")

    const context = await buildMemoryInjection("跑步")

    expect(context).toContain("用户喜欢跑步")
    expect(wasRecentlyInjectedMemory("l2_run")).toBe(true)
    expect(ragMock.searchMemoryEntries).toHaveBeenCalledWith("跑步", "user_memory", 5)
  })

  it("prefers DMAE-active L2 memories for injection", async () => {
    ragMock.searchMemoryEntries.mockResolvedValue([{
      id: "rag_search",
      text: "向量召回结果",
      createdAt: Date.now(),
      score: 0.8,
      metadata: { l2Id: "l2_search" },
    }])
    memoryStoreMock.getAllL2.mockResolvedValue([{
      id: "l2_active",
      content: "用户喜欢跑步",
      triggerText: "跑步",
      sourceConversationId: "test",
      createdAt: Date.now(),
      lastAccessedAt: Date.now(),
      accessCount: 0,
      weight: 0,
      isPinned: false,
      status: "active",
      syncStatus: "synced",
      ragId: "rag_active",
      conflictWith: [],
    }])
    l2DmaeManagerMock.getActiveL2ForPrompt.mockResolvedValue([{
      id: "l2_active",
      content: "用户喜欢跑步",
      triggerText: "跑步",
      sourceConversationId: "test",
      createdAt: Date.now(),
      lastAccessedAt: Date.now(),
      accessCount: 0,
      weight: 0,
      isPinned: false,
      status: "active",
      syncStatus: "synced",
      ragId: "rag_active",
      conflictWith: [],
    }])

    const { buildMemoryInjection } = await import("./index")

    const context = await buildMemoryInjection("跑步")

    expect(context).toContain("用户喜欢跑步")
    expect(context).not.toContain("向量召回结果")
    expect(wasRecentlyInjectedMemory("l2_active")).toBe(true)
    expect(l2DmaeManagerMock.getActiveL2ForPrompt).toHaveBeenCalledWith(expect.any(Array), 4)
    expect(ragMock.searchMemoryEntries).toHaveBeenCalledWith("跑步", "user_memory", 5)
  })
})
