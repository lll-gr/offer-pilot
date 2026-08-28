import { formatSectionNavSummary, formatSectionSummary, getSectionStats, SECTION_DEFINITIONS } from '@/resume/schema'
import type { ResumeProfile } from '@/resume/schema'

/** 侧栏「标准简历」页的区块摘要卡片 */
export function ResumeSummaryGrid({ profile }: { profile: ResumeProfile }) {
  const sectionStats = getSectionStats(profile)

  return (
    <div className="op-resume-summary">
      {SECTION_DEFINITIONS.map((section) => {
        const stats = sectionStats.get(section.key) || {
          totalFields: 0,
          filledFields: 0,
          itemCount: 0,
          filledItems: 0,
        }

        return (
          <div className="op-resume-summary-card" key={section.key}>
            <div className="op-resume-summary-title">{section.label}</div>
            <div className="op-resume-summary-meta">{formatSectionSummary(section, stats)}</div>
          </div>
        )
      })}
    </div>
  )
}

/** 全页编辑器左侧导航 */
export function ResumeNav({
  profile,
  collapsedSections,
  onNavigate,
}: {
  profile: ResumeProfile
  collapsedSections: Set<string>
  onNavigate: (sectionKey: string) => void
}) {
  const sectionStats = getSectionStats(profile)

  return (
    <aside className="op-editor-nav">
      {SECTION_DEFINITIONS.map((section) => {
        const stats = sectionStats.get(section.key) || {
          totalFields: 0,
          filledFields: 0,
          itemCount: 0,
          filledItems: 0,
        }
        const hasValue = section.type === 'list' ? stats.filledItems > 0 : stats.filledFields > 0

        return (
          <button
            key={section.key}
            type="button"
            className={`op-editor-nav-btn${hasValue ? ' has-value' : ''}`}
            onClick={() => onNavigate(section.key)}
          >
            <span className="op-editor-nav-label">{section.label}</span>
            <span className="op-editor-nav-meta">{formatSectionNavSummary(section, stats)}</span>
          </button>
        )
      })}
    </aside>
  )
}
