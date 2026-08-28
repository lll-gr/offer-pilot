import { formatSectionSummary, getListSectionInitialItems, getListSectionMaxItems, SECTION_DEFINITIONS } from '@/resume/schema'
import type { ResumeProfile, ResumeSectionDef, SectionStats } from '@/resume/schema'
import { FieldControl } from './FieldControl'

interface SectionCardProps {
  section: ResumeSectionDef
  stats: SectionStats | undefined
  profile: ResumeProfile
  collapsed: boolean
  onToggle: (sectionKey: string) => void
  onChange: (path: string, value: string) => void
  onAddItem: (sectionKey: string) => void
  onRemoveItem: (sectionKey: string, itemIndex: number) => void
}

function FieldGrid({
  section,
  profile,
  prefix,
  onChange,
}: {
  section: ResumeSectionDef
  profile: ResumeProfile
  prefix: string
  onChange: (path: string, value: string) => void
}) {
  return (
    <div className="op-rgroup-grid">
      {section.fields.map((field) => {
        const path = `${prefix}.${field.key}`
        const rawValue = getProfileValue(profile, path)

        return (
          <div className="op-rgroup-field" key={field.key}>
            <label className="op-rgroup-field-label">{field.label}</label>
            <FieldControl field={field} path={path} value={rawValue} onChange={onChange} />
          </div>
        )
      })}
    </div>
  )
}

function getProfileValue(profile: ResumeProfile, path: string): string {
  const segments = path.split('.')
  let current: unknown = profile
  for (const segment of segments) {
    if (current === null || current === undefined || typeof current !== 'object') return ''
    current = (current as Record<string, unknown>)[segment]
  }
  return current == null ? '' : String(current)
}

export function SectionCard({
  section,
  stats,
  profile,
  collapsed,
  onToggle,
  onChange,
  onAddItem,
  onRemoveItem,
}: SectionCardProps) {
  const isList = section.type === 'list'
  const rawItems = profile[section.key]
  const items = isList && Array.isArray(rawItems) ? rawItems : []
  const maxItems = isList ? getListSectionMaxItems(section) : 0
  const minItems = isList ? getListSectionInitialItems(section) : 1
  const statsOrDefault = stats || { totalFields: 0, filledFields: 0, itemCount: items.length, filledItems: 0 }

  return (
    <section
      className={`op-rgroup${collapsed ? ' is-collapsed' : ''}`}
      data-section-key={section.key}
      id={`resume-section-${section.key}`}
    >
      <div className="op-rgroup-head">
        <div className="op-rgroup-head-main">
          <button
            type="button"
            className="op-rgroup-toggle"
            aria-expanded={collapsed ? 'false' : 'true'}
            onClick={() => onToggle(section.key)}
          >
            <span className="op-rgroup-toggle-icon" aria-hidden="true">▸</span>
            <span className="op-rgroup-heading">
              <span className="op-rgroup-title">{section.label}</span>
              <span className="op-rgroup-summary">{formatSectionSummary(section, statsOrDefault)}</span>
            </span>
          </button>
          {isList ? (
            <div className="op-rgroup-actions">
              <button
                type="button"
                className="op-btn op-btn-ghost op-btn-sm"
                disabled={items.length >= maxItems}
                onClick={() => onAddItem(section.key)}
              >
                新增一条
              </button>
            </div>
          ) : null}
        </div>
        {section.note ? <div className="op-rgroup-note">{section.note}</div> : null}
      </div>

      <div className="op-rgroup-body">
        {section.type === 'group' ? (
          <FieldGrid section={section} profile={profile} prefix={section.key} onChange={onChange} />
        ) : (
          items.map((item, slotIndex) => (
            <div className="op-rgroup-item" key={slotIndex}>
              <div className="op-rgroup-item-head">
                <div>
                  <div className="op-rgroup-item-title">{`${section.itemLabel} ${slotIndex + 1}`}</div>
                  <div className="op-rgroup-item-subtitle">{`映射路径：${section.key}.${slotIndex}.*`}</div>
                </div>
                {items.length > Math.max(1, minItems) ? (
                  <button
                    type="button"
                    className="op-rgroup-item-remove"
                    onClick={() => onRemoveItem(section.key, slotIndex)}
                  >
                    删除
                  </button>
                ) : null}
              </div>
              <FieldGrid
                section={section}
                profile={profile}
                prefix={`${section.key}.${slotIndex}`}
                onChange={onChange}
              />
            </div>
          ))
        )}
      </div>
    </section>
  )
}

export const EDITOR_SECTIONS = SECTION_DEFINITIONS
