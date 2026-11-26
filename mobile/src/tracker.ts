export type Fix = {
  latitude: number;
  longitude: number;
  accuracy: number;
  time?: number | null;
  simulated?: boolean;
};
export type Receipt = {
  reading: { lat: number; lng: number; accuracy: number; capturedAt: number };
  status: string;
  receivedAt: number;
};
export type Watcher = {
  add(
    callback: (fix?: Fix, error?: { code?: string; message?: string }) => void,
  ): Promise<string>;
  remove(id: string): Promise<void>;
};
export type Update = {
  active: boolean;
  message: string;
  error?: boolean;
  receipt?: Receipt;
};
export class Tracker {
  private generation = 0;
  private id: string | null = null;
  private starting = false;
  private inFlight = false;
  private lastSent = 0;
  private lastAttempt = 0;
  constructor(
    private watcher: Watcher,
    private api: (route: string, body?: unknown) => Promise<unknown>,
    private update: (value: Update) => void,
    private now = Date.now,
  ) {}
  async start() {
    if (this.starting || this.id) return;
    this.starting = true;
    const generation = ++this.generation;
    this.lastSent = 0;
    this.lastAttempt = 0;
    try {
      await this.api("tracking", { enabled: true, consent: true });
      if (generation !== this.generation) {
        await this.api("tracking", { enabled: false, consent: false });
        return;
      }
      this.update({
        active: true,
        message: "Đang xin quyền và chờ GPS đầu tiên…",
      });
      const id = await this.watcher.add((fix, error) => {
        if (generation !== this.generation) return;
        if (error) {
          const message =
            error.code === "NOT_AUTHORIZED"
              ? "Chưa được cấp quyền vị trí nền. Mở quyền vị trí và thử lại."
              : (error.message ?? "Không lấy được GPS.");
          void this.stop()
            .catch(() => {})
            .finally(() =>
              this.update({ active: false, message, error: true }),
            );
        } else if (fix) void this.send(fix, generation);
      });
      if (generation !== this.generation) {
        await this.watcher.remove(id);
        return;
      }
      this.id = id;
    } catch (error) {
      if (generation === this.generation) {
        this.generation++;
        await this.api("tracking", { enabled: false, consent: false }).catch(
          () => {},
        );
        this.update({
          active: false,
          message: (error as Error).message,
          error: true,
        });
      }
    } finally {
      this.starting = false;
    }
  }
  private async send(fix: Fix, generation: number) {
    const now = this.now();
    if (
      this.inFlight ||
      (this.lastSent && now - this.lastSent < 60000) ||
      (this.lastAttempt && now - this.lastAttempt < 15000)
    )
      return;
    if (
      !Number.isFinite(fix.time) ||
      Math.abs(now - fix.time!) > 80000 ||
      fix.accuracy < 0 ||
      !Number.isFinite(fix.accuracy)
    ) {
      this.update({
        active: true,
        message: "Đang chờ mẫu GPS mới hợp lệ; chưa gửi vị trí cũ.",
      });
      return;
    }
    if (fix.simulated) {
      this.update({
        active: true,
        message: "Không gửi vị trí giả lập do hệ điều hành đánh dấu.",
        error: true,
      });
      return;
    }
    this.inFlight = true;
    this.lastAttempt = now;
    try {
      const receipt = (await this.api("location", {
        lat: fix.latitude,
        lng: fix.longitude,
        accuracy: fix.accuracy,
        capturedAt: Math.round(fix.time!),
      })) as Receipt;
      if (generation !== this.generation) return;
      this.lastSent = this.now();
      this.update({
        active: true,
        message:
          "Máy chủ đã lưu GPS. Tiếp tục chia sẻ trong nền khi hệ điều hành cho phép.",
        receipt,
      });
    } catch (error) {
      if (generation !== this.generation) return;
      const status = (error as { status?: number }).status;
      if (status === 401 || status === 403 || status === 400) {
        await this.stop(false).catch(() => {});
        this.update({
          active: false,
          message:
            status === 401
              ? "Phiên đã hết hạn. Đăng xuất rồi đăng nhập lại để tiếp tục."
              : (error as Error).message,
          error: true,
        });
      } else
        this.update({
          active: true,
          message:
            "Chưa gửi được GPS: " +
            (error as Error).message +
            ". Client sẽ thử lại khi có mẫu mới.",
          error: true,
        });
    } finally {
      this.inFlight = false;
    }
  }
  async stop(updateServer = true) {
    this.generation++;
    const id = this.id;
    this.id = null;
    let removalError: unknown;
    if (id) {
      try {
        await this.watcher.remove(id);
      } catch (error) {
        removalError = error;
      }
    }
    this.update({
      active: false,
      message: removalError
        ? "Đã ngừng gửi GPS; chưa gỡ được dịch vụ vị trí. Mở Cài đặt để tắt quyền vị trí."
        : "Đã dừng lấy vị trí trên thiết bị.",
      error: !!removalError,
    });
    if (updateServer)
      await this.api("tracking", { enabled: false, consent: false });
    if (removalError)
      throw new Error(
        "Chưa gỡ được dịch vụ vị trí; hãy mở Cài đặt để tắt quyền GPS.",
      );
  }
}
