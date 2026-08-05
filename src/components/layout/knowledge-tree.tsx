import { useState, useEffect, useCallback } from "react"
import {
  FileText, Users, Lightbulb, BookOpen, HelpCircle, GitMerge, BarChart3, ChevronRight, ChevronDown, Layout, Globe,
  GitBranch, AlertTriangle, Target, TrendingUp, Activity,
} from "lucide-react"
import { ScrollArea } from "@/components/ui/scroll-area"
import { useWikiStore } from "@/stores/wiki-store"
import { readFile, listDirectory } from "@/commands/fs"
import type { FileNode } from "@/types/wiki"
import { normalizePath } from "@/lib/path-utils"

interface WikiPageInfo {
  path: string
  title: string
  type: string
  tags: string[]
  origin?: string
}

const TYPE_CONFIG: Record<string, { icon: typeof FileText; label: string; color: string; order: number }> = {
  overview:    { icon: Layout,        label: "总览",     color: "text-yellow-500", order: 0 },
  entity:      { icon: Users,         label: "标的",     color: "text-blue-500",   order: 1 },
  concept:     { icon: Lightbulb,     label: "概念",     color: "text-purple-500", order: 2 },
  source:      { icon: BookOpen,      label: "来源",     color: "text-orange-500", order: 3 },
  synthesis:   { icon: GitMerge,      label: "总结",     color: "text-red-500",    order: 4 },
  comparison:  { icon: BarChart3,     label: "对比",     color: "text-emerald-500",order: 5 },
  query:       { icon: HelpCircle,    label: "查询",     color: "text-green-500",  order: 6 },
  pattern:     { icon: GitBranch,     label: "模式",     color: "text-pink-500",   order: 7 },
  mistake:     { icon: AlertTriangle, label: "错误",     color: "text-rose-500",   order: 8 },
  strategy:    { icon: Target,        label: "策略",     color: "text-cyan-500",   order: 9 },
  evolution:   { icon: TrendingUp,    label: "进化",     color: "text-indigo-500", order: 10 },
  market:      { icon: Activity,      label: "市场",     color: "text-teal-500",   order: 11 },
}

const DEFAULT_CONFIG = { icon: FileText, label: "其他", color: "text-muted-foreground", order: 99 }

/**
 * Maps Chinese / legacy type names written by the ingest pipeline to the
 * canonical English types used by TYPE_CONFIG. This keeps the Knowledge Tree
 * grouping consistent regardless of whether frontmatter uses `type: source`,
 * `type: 源文档`, or `type: 资料摘要`.
 */
const TYPE_NORMALIZATION: Record<string, string> = {
  // Source-like variants
  "源文档": "source",
  "sources": "source",
  "资料摘要": "source",
  // Chinese knowledge entities
  "股票": "entity",
  "概念": "concept",
  "总结": "synthesis",
  "模式": "pattern",
  "错误": "mistake",
  "策略": "strategy",
  "进化": "evolution",
  "市场环境": "market",
}

export function KnowledgeTree() {
  const project = useWikiStore((s) => s.project)
  const selectedFile = useWikiStore((s) => s.selectedFile)
  const setSelectedFile = useWikiStore((s) => s.setSelectedFile)
  const fileTree = useWikiStore((s) => s.fileTree)
  const [pages, setPages] = useState<WikiPageInfo[]>([])
  const [expandedTypes, setExpandedTypes] = useState<Set<string>>(new Set())

  const loadPages = useCallback(async () => {
    if (!project) return
    const pp = normalizePath(project.path)
    try {
      const wikiTree = await listDirectory(`${pp}/wiki`)
      const mdFiles = flattenMdFiles(wikiTree)

      const pageInfos: WikiPageInfo[] = []
      for (const file of mdFiles) {
        // Skip index.md, log.md and anything inside the logs/ directory
        // (those are daily operation logs, not knowledge pages).
        const normPath = file.path.replace(/\\/g, "/")
        if (file.name === "index.md" || file.name === "log.md" || normPath.includes("/logs/")) continue
        try {
          const content = await readFile(file.path)
          const info = parsePageInfo(file.path, file.name, content)
          pageInfos.push(info)
        } catch {
          pageInfos.push({
            path: file.path,
            title: file.name.replace(".md", "").replace(/-/g, " "),
            type: "other",
            tags: [],
          })
        }
      }

      setPages(pageInfos)
    } catch {
      setPages([])
    }
  }, [project])

  // Reload when file tree changes (after ingest writes new pages)
  useEffect(() => {
    loadPages()
  }, [loadPages, fileTree])

  if (!project) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-sm text-muted-foreground">
        未打开项目
      </div>
    )
  }

  // Group pages by type
  const grouped = new Map<string, WikiPageInfo[]>()
  for (const page of pages) {
    const list = grouped.get(page.type) ?? []
    list.push(page)
    grouped.set(page.type, list)
  }

  // Sort groups by configured order
  const sortedGroups = [...grouped.entries()].sort((a, b) => {
    const orderA = TYPE_CONFIG[a[0]]?.order ?? DEFAULT_CONFIG.order
    const orderB = TYPE_CONFIG[b[0]]?.order ?? DEFAULT_CONFIG.order
    return orderA - orderB
  })

  function toggleType(type: string) {
    setExpandedTypes((prev) => {
      const next = new Set(prev)
      if (next.has(type)) next.delete(type)
      else next.add(type)
      return next
    })
  }

  return (
    <ScrollArea className="h-full">
      <div className="p-2">
        <div className="mb-2 px-2 text-xs font-semibold uppercase text-muted-foreground">
          {project.name}
        </div>

        {sortedGroups.length === 0 && (
          <div className="px-2 py-4 text-center text-xs text-muted-foreground">
            暂无 Wiki 页面，请先导入来源资料。
          </div>
        )}

        {sortedGroups.map(([type, items]) => {
          const config = TYPE_CONFIG[type] ?? DEFAULT_CONFIG
          const Icon = config.icon
          const isExpanded = expandedTypes.has(type)

          return (
            <div key={type} className="mb-1">
              <button
                onClick={() => toggleType(type)}
                className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-sm hover:bg-accent/50"
              >
                {isExpanded ? (
                  <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                )}
                <Icon className={`h-3.5 w-3.5 shrink-0 ${config.color}`} />
                <span className="flex-1 text-left font-medium">{config.label}</span>
                <span className="text-xs text-muted-foreground">{items.length}</span>
              </button>

              {isExpanded && (
                <div className="ml-3">
                  {items.map((page) => {
                    const isSelected = selectedFile === page.path
                    return (
                      <button
                        key={page.path}
                        onClick={() => setSelectedFile(page.path)}
                        className={`flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-sm ${
                          isSelected
                            ? "bg-accent text-accent-foreground"
                            : "text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground"
                        }`}
                        title={page.path}
                      >
                        {page.origin === "web-clip" && <Globe className="h-3 w-3 shrink-0 text-blue-400" />}
                        <span className="truncate">{page.title}</span>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}

        {/* Raw sources quick access */}
        <RawSourcesSection />
      </div>
    </ScrollArea>
  )
}

function RawSourcesSection() {
  const project = useWikiStore((s) => s.project)
  const setSelectedFile = useWikiStore((s) => s.setSelectedFile)
  const selectedFile = useWikiStore((s) => s.selectedFile)
  const [expanded, setExpanded] = useState(false)
  const [sources, setSources] = useState<FileNode[]>([])

  useEffect(() => {
    if (!project) return
    const pp = normalizePath(project.path)
    listDirectory(`${pp}/raw/sources`)
      .then((tree) => setSources(flattenAllFiles(tree)))
      .catch(() => setSources([]))
  }, [project])

  if (sources.length === 0) return null

  return (
    <div className="mt-2 border-t pt-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-sm hover:bg-accent/50"
      >
        {expanded ? (
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        )}
        <BookOpen className="h-3.5 w-3.5 shrink-0 text-amber-600" />
        <span className="flex-1 text-left font-medium text-muted-foreground">原始来源</span>
        <span className="text-xs text-muted-foreground">{sources.length}</span>
      </button>
      {expanded && (
        <div className="ml-3">
          {sources.map((file) => {
            const isSelected = selectedFile === file.path
            return (
              <button
                key={file.path}
                onClick={() => setSelectedFile(file.path)}
                className={`flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-sm ${
                  isSelected
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground"
                }`}
              >
                <span className="truncate">{file.name}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

function parsePageInfo(path: string, fileName: string, content: string): WikiPageInfo {
  let type = "other"
  let title = fileName.replace(".md", "").replace(/-/g, " ")
  const tags: string[] = []
  let origin: string | undefined

  // Parse YAML frontmatter
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/)
  if (fmMatch) {
    const fm = fmMatch[1]
    const typeMatch = fm.match(/^type:\s*(.+)$/m)
    if (typeMatch) type = typeMatch[1].trim().toLowerCase()

    const titleMatch = fm.match(/^title:\s*["']?(.+?)["']?\s*$/m)
    if (titleMatch) title = titleMatch[1].trim()

    const tagsMatch = fm.match(/^tags:\s*\[(.+?)\]/m)
    if (tagsMatch) {
      tags.push(...tagsMatch[1].split(",").map((t) => t.trim().replace(/["']/g, "")))
    }

    const originMatch = fm.match(/^origin:\s*(.+)$/m)
    if (originMatch) origin = originMatch[1].trim()
  }

  // Fallback: try first heading if no frontmatter title
  if (title === fileName.replace(".md", "").replace(/-/g, " ")) {
    const headingMatch = content.match(/^#\s+(.+)$/m)
    if (headingMatch) title = headingMatch[1].trim()
  }

  // Normalize path separators so the directory fallback works on Windows
  // (where listDirectory returns backslash-separated paths) as well as POSIX.
  const normalizedPath = path.replace(/\\/g, "/")

  // Fallback: infer type from path (covers both English and Chinese dirs)
  if (type === "other") {
    if (normalizedPath.includes("/entities/")) type = "entity"
    else if (normalizedPath.includes("/concepts/") || normalizedPath.includes("/概念/")) type = "concept"
    else if (normalizedPath.includes("/sources/") || normalizedPath.includes("/源文档/")) type = "source"
    else if (normalizedPath.includes("/queries/")) type = "query"
    else if (normalizedPath.includes("/comparisons/")) type = "comparison"
    else if (normalizedPath.includes("/synthesis/") || normalizedPath.includes("/总结/")) type = "synthesis"
    else if (normalizedPath.includes("/股票/")) type = "entity"
    else if (normalizedPath.includes("/模式/")) type = "pattern"
    else if (normalizedPath.includes("/错误/")) type = "mistake"
    else if (normalizedPath.includes("/策略/")) type = "strategy"
    else if (normalizedPath.includes("/进化/")) type = "evolution"
    else if (normalizedPath.includes("/市场环境/")) type = "market"
    else if (fileName === "overview.md") type = "overview"
  }

  // Normalize Chinese / legacy types to canonical English types for display.
  type = TYPE_NORMALIZATION[type] ?? type

  return { path, title, type, tags, origin }
}

function flattenMdFiles(nodes: FileNode[]): FileNode[] {
  const files: FileNode[] = []
  for (const node of nodes) {
    if (node.is_dir && node.children) {
      files.push(...flattenMdFiles(node.children))
    } else if (!node.is_dir && node.name.endsWith(".md")) {
      files.push(node)
    }
  }
  return files
}

function flattenAllFiles(nodes: FileNode[]): FileNode[] {
  const files: FileNode[] = []
  for (const node of nodes) {
    if (node.is_dir && node.children) {
      files.push(...flattenAllFiles(node.children))
    } else if (!node.is_dir) {
      files.push(node)
    }
  }
  return files
}
