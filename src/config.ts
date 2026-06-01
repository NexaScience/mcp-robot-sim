import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const EnvSchema = z.object({
  MCP_HTTP_PORT: z.coerce.number().int().positive().default(3000),
});

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid env:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}
export const config = parsed.data;
