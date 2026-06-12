import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema";

let client: ReturnType<typeof postgres> | null = null;
let dbInstance: ReturnType<typeof drizzle<typeof schema>> | null = null;

function getClient() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL environment variable is not set");
  }
  if (!client) {
    client = postgres(connectionString, { max: 10 });
  }
  return client;
}

export const db = new Proxy({} as ReturnType<typeof drizzle<typeof schema>>, {
  get(_target, prop, receiver) {
    if (!dbInstance) {
      dbInstance = drizzle(getClient(), { schema });
    }
    return Reflect.get(dbInstance, prop, receiver);
  },
});

export async function ensureExtensions() {
  const sql = getClient();
  await sql`CREATE EXTENSION IF NOT EXISTS vector`;
}
