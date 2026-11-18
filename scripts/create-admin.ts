import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import { createUser } from "../src/lib/auth";
import { collections, closeDatabase } from "../src/lib/db";
const prompt = createInterface({
  input: process.stdin,
  output: process.stdout,
});
const email = (await prompt.question("Email quản trị: ")).trim().toLowerCase();
const name = (await prompt.question("Họ tên: ")).trim();
prompt.close();
let muted = false;
const output = new Writable({
  write(chunk, _encoding, callback) {
    if (!muted) process.stdout.write(chunk);
    callback();
  },
});
const secretPrompt = createInterface({
  input: process.stdin,
  output,
  terminal: true,
});
const pending = secretPrompt.question(
  "Mật khẩu (ít nhất 12 ký tự, không hiển thị): ",
);
muted = true;
const password = await pending;
secretPrompt.close();
process.stdout.write("\n");
if (
  !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
  name.length < 2 ||
  password.length < 12 ||
  password.length > 128
)
  throw new Error("Thông tin không hợp lệ.");
if (await (await collections()).users.findOne({ email }))
  throw new Error("Email đã tồn tại.");
await createUser(name, email, password, "admin");
await closeDatabase();
console.log("Đã tạo quản trị viên.");
