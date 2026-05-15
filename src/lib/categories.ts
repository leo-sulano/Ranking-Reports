export type CategoryId = 'bp-sites' | 'lp-sites'

export interface Category {
  id:    CategoryId
  label: string
  path:  string
}

export const CATEGORIES: Category[] = [
  { id: 'bp-sites', label: 'BP Sites', path: '/bp-sites' },
  { id: 'lp-sites', label: 'LP Sites', path: '/lp-sites' },
]

export const DEFAULT_CATEGORY: CategoryId = 'bp-sites'

export const CATEGORY_BY_ID: Record<CategoryId, Category> = Object.fromEntries(
  CATEGORIES.map((c) => [c.id, c]),
) as Record<CategoryId, Category>
