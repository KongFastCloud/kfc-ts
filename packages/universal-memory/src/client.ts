import { neon } from "@neondatabase/serverless"
import { drizzle } from "drizzle-orm/neon-http"
import * as schema from "./schema"

export function createDb(databaseUrl: string) {
  const sql = neon(databaseUrl)
  return drizzle({ client: sql, schema })
}

export const db = createDb(process.env.DATABASE_URL!)

export type Database = ReturnType<typeof createDb>
