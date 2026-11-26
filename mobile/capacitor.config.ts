import type { CapacitorConfig } from "@capacitor/cli";
const config: CapacitorConfig = {
  appId: "vn.edu.ph1tsqmt.campusguard",
  appName: "Campus Guard",
  webDir: "dist",
  loggingBehavior: "none",
  android: { useLegacyBridge: true },
  plugins: { CapacitorHttp: { enabled: true } },
};
export default config;
