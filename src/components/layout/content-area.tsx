import { useWikiStore } from "@/stores/wiki-store"
import { ChatPanel } from "@/components/chat/chat-panel"
import { SettingsView } from "@/components/settings/settings-view"
import { SourcesView } from "@/components/sources/sources-view"
import { ReviewView } from "@/components/review/review-view"
import { LintView } from "@/components/lint/lint-view"
import { SearchView } from "@/components/search/search-view"
import { GraphView } from "@/components/graph/graph-view"
import { DashboardView } from "@/components/dashboard/dashboard-view"
import { ResearchCockpitView } from "@/components/dashboard/research-cockpit-view"
import { TrainingFlywheelView } from "@/components/training/training-flywheel-view"
import { PlanAuditView } from "@/components/plan/plan-audit-view"

export function ContentArea() {
  const activeView = useWikiStore((s) => s.activeView)

  switch (activeView) {
    case "settings":
      return <SettingsView />
    case "sources":
      return <SourcesView />
    case "review":
      return <ReviewView />
    case "lint":
      return <LintView />
    case "search":
      return <SearchView />
    case "graph":
      return <GraphView />
    case "dashboard":
      return <DashboardView />
    case "research-cockpit":
      return (
        <div className="h-full overflow-auto p-6">
          <ResearchCockpitView />
        </div>
      )
    case "training-flywheel":
      return <TrainingFlywheelView />
    case "plan":
      return <PlanAuditView />
    default:
      return <ChatPanel />
  }
}
