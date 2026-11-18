import nextEnv from "@next/env";
import { MongoClient } from "mongodb";
nextEnv.loadEnvConfig(process.cwd());
const uri = process.env.MONGODB_URI;
if (!uri) throw new Error("Chưa cấu hình MONGODB_URI.");
const client = new MongoClient(uri, {
  serverSelectionTimeoutMS: 10000,
  connectTimeoutMS: 10000,
});
try {
  await client.connect();
  await client
    .db(process.env.MONGODB_DB || "campus_guard")
    .command({ ping: 1 });
  console.log(
    "MongoDB ping thành công. Database: " +
      (process.env.MONGODB_DB || "campus_guard"),
  );
} catch {
  console.error(
    "Không kết nối được MongoDB. Kiểm tra URI, thông tin đăng nhập, DNS và Atlas Network Access.",
  );
  process.exitCode = 1;
} finally {
  await client.close();
}
