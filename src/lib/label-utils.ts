function isAutoLabel(label: string, skill?: string, skillVersion?: number | null) {
  if (!label) return false
  if (label === "without-skill") return true
  if (!skill) return false
  const m = label.match(/^(.+)-v(\d+)$/)
  if (!m) return false
  const name = m[1]
  const ver = Number(m[2])
  if (!Number.isFinite(ver)) return false
  if (name !== skill) return false
  if (skillVersion == null) return true
  return true
}

export function chooseExecutionLabel(args: {
  existingLabel?: string | null
  incomingLabel?: string | null
  skill?: string | null
  skillVersion?: number | null
}) {
  const incoming = typeof args.incomingLabel === "string" ? args.incomingLabel.trim() : undefined
  if (incoming !== undefined) {
    if (!incoming) return undefined
    return incoming
  }

  const existing = typeof args.existingLabel === "string" ? args.existingLabel.trim() : ""
  const skill = typeof args.skill === "string" ? args.skill.trim() : ""
  const skillVersion = args.skillVersion ?? null

  if (existing && !isAutoLabel(existing, skill || undefined, skillVersion)) return existing

  if (skill) {
    const v = typeof skillVersion === "number" && Number.isFinite(skillVersion) ? skillVersion : 1
    return `${skill}-v${v}`
  }

  return "without-skill"
}

