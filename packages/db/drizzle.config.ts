import { config } from "dotenv"
import { defineConfig } from "drizzle-kit"

config({ path: "../../apps/kongfastchat/.env.local" })

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
  schemaFilter: ["public", "neon_auth"],
})
