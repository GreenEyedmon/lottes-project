import { drizzle } from 'drizzle-orm/d1'
import * as schema from './schema.ts'

/** Build a Drizzle client bound to the request's D1 binding (`env.DB`). */
export function getDb(binding: D1Database) {
  return drizzle(binding, { schema })
}

export type Db = ReturnType<typeof getDb>

export * as schema from './schema.ts'
