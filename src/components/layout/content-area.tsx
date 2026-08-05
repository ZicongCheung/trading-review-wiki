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
import { DailyLoopPanel } from "@/components/dashboard/daily-loop-panel"
import { CompanyResearchPanel } from "@/components/dashboard/company-research-panel"
import { SelfQuestionPanel } from "@/components/dashboard/self-question-panel"
import { ResearchConsolePanel } from "@/components/dashboard/research-console-panel"
import { DataEngineeringPanel } from "@/components/dashboard/data-engineering-panel"
import { HypothesisEvolutionPanel } from "@/components/dashboard/hypothesis-evolution-panel"
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
    case "daily-loop":
      return (
        <div className="h-full overflow-auto">
          <DailyLoopPanel />
        </div>
      )
    case "company-research":
      return (
        <div className="h-full overflow-auto">
          <CompanyResearchPanel />
        </div>
      )
    case "self-question":
      return (
        <div className="h-full overflow-auto">
          <SelfQuestionPanel />
        </div>
      )
    case "research-console":
      return (
        <div className="h-full overflow-auto">
          <ResearchConsolePanel />
        </div>
      )
    case "data-engineering":
      return (
        <div className="h-full overflow-auto">
          <DataEngineeringPanel />
        </div>
      )
    case "hypothesis-evolution":
      return (
        <div className="h-full overflow-auto">
          <HypothesisEvolutionPanel />
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
