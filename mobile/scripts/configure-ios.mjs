import { readFile, writeFile } from "node:fs/promises";
const path = new URL("../ios/App/App/Info.plist", import.meta.url);
let plist = await readFile(path, "utf8");
function appendToRoot(xml) {
  const index = plist.lastIndexOf("</dict>");
  if (index < 0) throw new Error("Invalid Info.plist root");
  plist = plist.slice(0, index) + xml + plist.slice(index);
}
const keys = [
  [
    "NSLocationWhenInUseUsageDescription",
    "Campus Guard dùng GPS khi bạn bật chia sẻ vị trí với quản trị viên.",
  ],
  [
    "NSLocationAlwaysAndWhenInUseUsageDescription",
    "Khi bạn đồng ý, Campus Guard gửi vị trí kể cả lúc khóa màn hình hoặc chuyển ứng dụng. Bạn có thể dừng chia sẻ trong ứng dụng.",
  ],
];
for (const [key, text] of keys) {
  if (!plist.includes(`<key>${key}</key>`))
    appendToRoot(`\t<key>${key}</key>\n\t<string>${text}</string>\n`);
}
if (!plist.includes("<key>UIBackgroundModes</key>"))
  appendToRoot(
    "\t<key>UIBackgroundModes</key>\n\t<array><string>location</string></array>\n",
  );
await writeFile(path, plist);
console.log(
  "Configured iOS location permission descriptions and background location mode.",
);
