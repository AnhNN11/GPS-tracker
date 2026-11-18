import { sweep } from "../src/lib/store";
// Dedicated process: alerts continue to be created when all browsers are closed.
function tick() {
  try {
    sweep();
  } catch (e) {
    console.error("Monitor error:", e);
  }
}
tick();
const timer = setInterval(tick, 30000);
console.log("Giám sát mất cập nhật đang chạy; kiểm tra mỗi 30 giây.");
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    clearInterval(timer);
    process.exit(0);
  });
