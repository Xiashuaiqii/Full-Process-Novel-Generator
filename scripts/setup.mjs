import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";

const envPath = ".env";
const examplePath = ".env.example";

if (!existsSync(envPath)) {
  const example = readFileSync(examplePath, "utf8");
  const key = randomBytes(32).toString("hex");
  const env = example.replace(
    /ENCRYPTION_KEY="[^"]*"/,
    `ENCRYPTION_KEY="${key}"`
  );
  writeFileSync(envPath, env, "utf8");
  console.log("已自动创建 .env，并生成本地 ENCRYPTION_KEY。");
} else {
  console.log(".env 已存在，跳过创建。");
}
