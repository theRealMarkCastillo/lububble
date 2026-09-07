import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const client = postgres(process.env.DATABASE_URL ?? "postgres://lububble:lububble@db:5432/app");

export const db = drizzle(client, { schema });
