// Read all pages so large rosters and reports are not silently truncated.
export async function allRows<T>(query: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>): Promise<T[]> {
  const result: T[] = []
  const size = 500
  for (let offset = 0; ; offset += size) {
    const { data, error } = await query(offset, offset + size - 1)
    if (error) throw new Error(error.message)
    result.push(...((data || []) as T[]))
    if (!data || data.length < size) return result
  }
}
