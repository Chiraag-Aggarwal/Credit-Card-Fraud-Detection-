// Date inputs represent local calendar days; API filters are absolute instants.
export function dateFilterBoundary(value, endOfDay = false) {
  if (!value) return undefined
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Invalid date filter.')
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) throw new Error('Invalid date filter.')
  if (endOfDay) date.setHours(23, 59, 59, 999)
  else date.setHours(0, 0, 0, 0)
  return date.toISOString()
}
