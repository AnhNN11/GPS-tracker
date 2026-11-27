"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import {
  Alert,
  App,
  Avatar,
  Badge,
  Button,
  Checkbox,
  ConfigProvider,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Spin,
  Table,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import {
  AimOutlined,
  ArrowLeftOutlined,
  ArrowRightOutlined,
  BellOutlined,
  CheckCircleOutlined,
  DashboardOutlined,
  HistoryOutlined,
  EnvironmentOutlined,
  FieldTimeOutlined,
  LogoutOutlined,
  PlusOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
  SettingOutlined,
  TeamOutlined,
  UndoOutlined,
} from "@ant-design/icons";
import { circlePolygon, validCircle, type Point } from "@/lib/geo";
import { rosterCounts } from "@/lib/roster";
import { deviceContext } from "@/lib/device-context";
import { withRequestTimeout } from "@/lib/request-timeout";
import { createStateRefresh } from "@/lib/state-refresh";
import { boundaryDraftKey } from "@/lib/boundary-draft";
import { schoolCenter, schoolRadiusMeters } from "@/lib/campus-preset";
import HistoryPanel from "./history-panel";
import { useScreenAwake } from "./use-screen-awake";
import {
  useLocationSharing,
  type LocationReceipt,
} from "./use-location-sharing";
import type { Campus } from "@/lib/store";
import type { CampusAlert, Person, State } from "@/lib/types";
const Map = dynamic(() => import("./campus-map"), {
  ssr: false,
  loading: () => (
    <div className="map-loading">
      <Spin />
      <span>Đang tải bản đồ…</span>
    </div>
  ),
});
type Tab = "history" | "overview" | "boundary" | "people" | "alerts" | "me";
const statuses: Record<string, { label: string; color: string }> = {
  inside: { label: "Trong khuôn viên", color: "green" },
  outside: { label: "Ngoài khuôn viên", color: "red" },
  pending: { label: "Ngoài vùng · chờ thêm mẫu xác nhận", color: "gold" },
  uncertain: { label: "GPS chưa rõ", color: "default" },
  stale: { label: "Mất cập nhật", color: "orange" },
  unknown: { label: "Chưa có vị trí", color: "default" },
  unconfigured: { label: "Chưa có ranh giới", color: "default" },
};
const time = (v: number | null) =>
  v
    ? new Date(v).toLocaleString("vi-VN", {
        timeZone: "Asia/Ho_Chi_Minh",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        day: "2-digit",
        month: "2-digit",
      })
    : "Chưa cập nhật";
function Status({ person }: { person: Person }) {
  const s = !person.tracking
    ? { label: "Chưa chia sẻ", color: "default" }
    : (statuses[person.status] ?? statuses.unknown);
  return (
    <Tag color={s.color} bordered={false}>
      {s.label}
    </Tag>
  );
}
async function api<T = unknown>(
  route: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  return withRequestTimeout(async (signal) => {
    const response = await fetch(`/api/${route}`, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
      signal,
    });
    const data = await response.json();
    if (!response.ok) {
      const err = new Error(
        data.error || "Không thể kết nối máy chủ.",
      ) as Error & { status: number };
      err.status = response.status;
      throw err;
    }
    return data;
  }, 25000);
}
export default function Dashboard() {
  return (
    <ConfigProvider
      theme={{
        token: {
          colorPrimary: "#167d68",
          colorInfo: "#167d68",
          borderRadius: 10,
          fontFamily: "Arial, Helvetica, sans-serif",
          colorText: "#142c24",
          colorTextSecondary: "#435b51",
          colorSuccess: "#087443",
          colorWarning: "#985500",
          colorError: "#c32626",
          colorBorder: "#e2e8e5",
          controlHeight: 40,
        },
        components: {
          Table: { headerBg: "#f5f8f6", headerColor: "#708078" },
          Modal: { borderRadiusLG: 16 },
        },
      }}
    >
      <App>
        <Screen />
      </App>
    </ConfigProvider>
  );
}
function Screen() {
  const { message, modal } = App.useApp();
  const [me, setMe] = useState<Person | null>(null),
    [ready, setReady] = useState(false),
    [state, setState] = useState<State | null>(null),
    [tab, setTab] = useState<Tab>("overview"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [createOpen, setCreateOpen] = useState(false),
    [boundaryOpen, setBoundaryOpen] = useState(false),
    [draft, setDraft] = useState<Point[]>([]),
    [boundaryMode, setBoundaryMode] = useState<"circle" | "polygon">("circle"),
    [regionFitRevision, setRegionFitRevision] = useState(0),
    [overviewFitRevision, setOverviewFitRevision] = useState(0),
    [placingCenter, setPlacingCenter] = useState(false),
    [focus, setFocus] = useState<Point | null>(null),
    [query, setQuery] = useState("");
  const [consent, setConsent] = useState(false),
    [keepScreenOn, setKeepScreenOn] = useState(false),
    [report, setReport] = useState<CampusAlert | null>(null),
    [reportText, setReportText] = useState("");
  const [userForm] = Form.useForm(),
    [campusForm] = Form.useForm(),
    [loginForm] = Form.useForm();
  const watchedBoundary = Form.useWatch([], {
    form: campusForm,
    preserve: true,
  });
  const watchedCircle = watchedBoundary?.circle;
  const boundaryBaseline = useRef("");
  const leavePromptOpen = useRef(false);
  const boundaryDirty = !!(
    boundaryOpen &&
    watchedBoundary &&
    boundaryDraftKey(boundaryMode, watchedBoundary, draft) !==
      boundaryBaseline.current
  );
  const previewCircle =
    boundaryOpen && boundaryMode === "circle" && validCircle(watchedCircle)
      ? watchedCircle
      : undefined;
  const previewPolygon =
    boundaryMode === "circle"
      ? previewCircle
        ? circlePolygon(previewCircle)
        : []
      : draft;
  const screenAwake = useScreenAwake(keepScreenOn && !!me?.tracking);
  const stateRefresh = useRef<ReturnType<
    typeof createStateRefresh<State>
  > | null>(null);
  if (!stateRefresh.current) {
    stateRefresh.current = createStateRefresh<State>({
      load: () => api<State>("state"),
      apply: (next) => {
        setState(next);
        setMe(next.me);
        setError("");
      },
      onError: (e) => {
        if ((e as Error & { status?: number }).status === 401) {
          stateRefresh.current!.invalidate();
          resetSessionUi();
          setMe(null);
          setState(null);
        } else setError((e as Error).message);
      },
    });
  }
  const refresh = useCallback(
    (force = false) => stateRefresh.current!.request(force),
    [],
  );
  useEffect(() => {
    if (!boundaryDirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [boundaryDirty]);
  useEffect(() => {
    let active = true;
    api<{ user: Person | null }>("auth/me")
      .then(async (r) => {
        if (!active) return;
        setMe(r.user);
        if (r.user) await refresh(true);
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setReady(true);
      });
    return () => {
      active = false;
      stateRefresh.current!.invalidate();
    };
  }, [refresh]);
  useEffect(() => {
    if (!me) return;
    const id = setInterval(refresh, 15000);
    const resume = () => {
      if (!document.hidden) void refresh(true);
    };
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("pageshow", resume);
    window.addEventListener("online", resume);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("pageshow", resume);
      window.removeEventListener("online", resume);
    };
  }, [me?.id, refresh]); // eslint-disable-line react-hooks/exhaustive-deps
  const gps = useLocationSharing(
    me?.id,
    !!me?.tracking,
    (reading) =>
      api<LocationReceipt>("location", "POST", {
        ...reading,
        ...deviceContext(),
      }),
    (receipt) => {
      const update = (person: Person): Person =>
        person.id === me?.id
          ? {
              ...person,
              reading: receipt.reading,
              status: receipt.status,
              lastReceivedAt: receipt.receivedAt,
            }
          : person;
      setMe((person) => (person ? update(person) : person));
      setState((previous) =>
        previous
          ? {
              ...previous,
              me: update(previous.me),
              users: previous.users.map(update),
            }
          : previous,
      );
      if (tab === "me") setFocus(receipt.reading);
      void refresh(true);
    },
  );
  async function act(action: () => Promise<unknown>, success?: string) {
    setBusy(true);
    try {
      await action();
      if (success) message.success(success);
      await refresh(true);
      return true;
    } catch (e) {
      message.error((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function login(values: unknown) {
    setBusy(true);
    try {
      const r = await api<{ user: Person }>("auth/login", "POST", values);
      stateRefresh.current!.invalidate();
      resetSessionUi();
      setState(null);
      setFocus(null);
      setMe(r.user);
      setTab(r.user.role === "admin" ? "overview" : "me");
      await refresh(true);
      loginForm.resetFields();
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function requestBoundaryExit(action: () => void | Promise<void>) {
    if (boundaryOpen && busy) return;
    if (!boundaryDirty) {
      void action();
      return;
    }
    if (leavePromptOpen.current) return;
    leavePromptOpen.current = true;
    modal.confirm({
      title: "Ranh giới có thay đổi chưa lưu",
      content:
        "Rời màn hình sẽ bỏ bản nháp. Vùng đã lưu trên máy chủ vẫn được giữ nguyên.",
      okText: "Bỏ thay đổi",
      cancelText: "Tiếp tục chỉnh sửa",
      okButtonProps: { danger: true },
      onCancel: () => {
        leavePromptOpen.current = false;
      },
      onOk: async () => {
        leavePromptOpen.current = false;
        setBoundaryOpen(false);
        setPlacingCenter(false);
        await action();
      },
    });
  }
  function navigate(next: Tab, point: Point | null = null) {
    if (next === tab) {
      setFocus(point);
      return;
    }
    requestBoundaryExit(() => {
      setTab(next);
      setFocus(point);
      setBoundaryOpen(false);
      setPlacingCenter(false);
    });
  }
  function logout() {
    requestBoundaryExit(performLogout);
  }
  function resetSessionUi() {
    setBoundaryOpen(false);
    setPlacingCenter(false);
    setCreateOpen(false);
    setReport(null);
    setFocus(null);
    setConsent(false);
    setKeepScreenOn(false);
    campusForm.resetFields();
    userForm.resetFields();
  }
  async function performLogout() {
    try {
      await api("auth/logout", "POST", {});
      stateRefresh.current!.invalidate();
      resetSessionUi();
      setMe(null);
      setState(null);
      setFocus(null);
      setConsent(false);
      setKeepScreenOn(false);
    } catch (e) {
      message.error((e as Error).message);
    }
  }
  const admin = me?.role === "admin";
  if (!ready)
    return (
      <div className="boot">
        <Spin size="large" />
        <p>Đang kết nối Campus Guard…</p>
      </div>
    );
  if (!me)
    return (
      <main className="login">
        <section className="login-story">
          <a className="brand">
            <span className="brand-symbol">
              <SafetyCertificateOutlined />
            </span>
            Campus<span>Guard</span>
          </a>
          <div>
            <div className="eyebrow">KẾT NỐI ĐỂ AN TÂM</div>
            <h1>
              Một khuôn viên.
              <br />
              Mọi kết nối
              <br />
              <em>trong tầm nhìn.</em>
            </h1>
            <p>
              Quản lý vị trí và theo dõi ranh giới trường học
              <br />
              trên một không gian chung.
            </p>
            <div className="school-stamp">
              <EnvironmentOutlined />
              <span>
                Phân hiệu 1<br />
                <strong>Trường Thiếu sinh quân miền Trung</strong>
                <small>534 Phạm Văn Đồng · Thống Nhất · Gia Lai</small>
              </span>
            </div>
          </div>
          <small>Định vị minh bạch. Cảnh báo rõ ràng.</small>
        </section>
        <section className="login-panel">
          <div className="login-form">
            <div className="eyebrow">CHÀO MỪNG TRỞ LẠI</div>
            <h2>Đăng nhập hệ thống</h2>
            <p className="muted">
              Sử dụng tài khoản do quản trị viên cung cấp.
            </p>
            {error && <Alert type="error" title={error} showIcon />}
            <Form form={loginForm} layout="vertical" onFinish={login}>
              <Form.Item
                name="email"
                label="Địa chỉ email"
                rules={[
                  {
                    required: true,
                    type: "email",
                    message: "Nhập email hợp lệ.",
                  },
                ]}
              >
                <Input
                  autoComplete="username"
                  placeholder="ten@truong.edu.vn"
                />
              </Form.Item>
              <Form.Item
                name="password"
                label="Mật khẩu"
                rules={[{ required: true, message: "Nhập mật khẩu." }]}
              >
                <Input.Password
                  autoComplete="current-password"
                  placeholder="Mật khẩu của bạn"
                />
              </Form.Item>
              <Button
                type="primary"
                htmlType="submit"
                block
                loading={busy}
                icon={<ArrowRightOutlined />}
                iconPlacement="end"
              >
                Đăng nhập
              </Button>
            </Form>
            <p className="login-help">
              <SafetyCertificateOutlined /> Tài khoản và vị trí được phân quyền
              truy cập.
            </p>
            <Alert
              type="info"
              title="Lần đầu sử dụng?"
              description={
                <span>
                  Chủ sở hữu dùng mã thiết lập riêng để{" "}
                  <a href="/setup">tạo quản trị viên ngay trên website</a>.
                </span>
              }
            />
          </div>
        </section>
      </main>
    );
  const activeAlerts = state?.alerts.filter((a) => !a.resolved_at) ?? [],
    people = state?.users ?? [],
    campus = state?.campus;
  const visiblePeople = people.filter((p) =>
    `${p.name} ${p.email}`.toLowerCase().includes(query.toLowerCase()),
  );
  const roster = rosterCounts(
    people,
    state?.serverTime ?? Date.now(),
    campus?.policy.staleMinutes ?? 5,
  );
  const navigation: { key: Tab; icon: React.ReactNode; label: string }[] = admin
    ? [
        {
          key: "history",
          icon: <HistoryOutlined />,
          label: "Lịch sử & phân tích",
        },
        {
          key: "overview",
          icon: <DashboardOutlined />,
          label: "Dashboard quân số",
        },
        {
          key: "boundary",
          icon: <EnvironmentOutlined />,
          label: "Khuôn viên trường",
        },
        { key: "people", icon: <TeamOutlined />, label: "Tài khoản" },
        { key: "alerts", icon: <BellOutlined />, label: "Sự kiện" },
        { key: "me", icon: <AimOutlined />, label: "Vị trí của tôi" },
      ]
    : [
        { key: "history", icon: <HistoryOutlined />, label: "Lịch sử của tôi" },
        { key: "me", icon: <AimOutlined />, label: "Vị trí của tôi" },
        { key: "alerts", icon: <BellOutlined />, label: "Sự kiện & báo cáo" },
      ];
  const current = admin
    ? tab
    : tab === "alerts"
      ? "alerts"
      : tab === "history"
        ? "history"
        : "me";
  const title = navigation.find((n) => n.key === current)?.label ?? "Tổng quan";
  const peopleColumns = [
    {
      title: "NGƯỜI DÙNG",
      key: "name",
      render: (_: unknown, p: Person) => (
        <div className="person">
          <Avatar style={{ background: "#e8f1ed", color: "#167d68" }}>
            {p.name.charAt(0)}
          </Avatar>
          <span>
            <strong>{p.name}</strong>
            <small>{p.email}</small>
          </span>
        </div>
      ),
    },
    {
      title: "TRẠNG THÁI",
      key: "status",
      render: (_: unknown, p: Person) => <Status person={p} />,
    },
    {
      title: "CẬP NHẬT CUỐI",
      key: "time",
      render: (_: unknown, p: Person) => (
        <span className="muted">{time(p.reading?.capturedAt ?? null)}</span>
      ),
    },
    {
      title: "SAI SỐ GPS",
      key: "accuracy",
      render: (_: unknown, p: Person) =>
        p.reading ? `±${Math.round(p.reading.accuracy)} m` : "—",
    },
    {
      title: "",
      key: "actions",
      render: (_: unknown, p: Person) => (
        <Space>
          {p.reading && (
            <Button
              type="text"
              icon={<AimOutlined />}
              aria-label={`Xem vị trí ${p.name}`}
              onClick={() => {
                navigate("overview", p.reading);
              }}
            />
          )}
          {current === "people" && p.role !== "admin" && (
            <Button
              size="small"
              danger={p.enabled}
              onClick={() =>
                act(
                  () => api(`users/${p.id}`, "PATCH", { enabled: !p.enabled }),
                  p.enabled ? "Đã khóa tài khoản" : "Đã mở tài khoản",
                )
              }
            >
              {p.enabled ? "Khóa" : "Mở khóa"}
            </Button>
          )}
          {!p.enabled && <Tag>Đã khóa</Tag>}
        </Space>
      ),
    },
  ];
  function openBoundary() {
    if (boundaryOpen) return;
    setPlacingCenter(false);
    setDraft(campus?.polygon ?? []);
    const mode = campus?.circle ? "circle" : "polygon";
    setBoundaryMode(mode);
    setFocus(null);
    const values = {
      ...campus,
      circle: campus?.circle ?? {
        center: schoolCenter,
        radiusMeters: schoolRadiusMeters,
      },
    };
    boundaryBaseline.current = boundaryDraftKey(
      mode,
      values,
      campus?.polygon ?? [],
    );
    campusForm.setFieldsValue(values);
    setTab("boundary");
    setBoundaryOpen(true);
  }
  async function saveBoundary() {
    try {
      const values = await campusForm.validateFields();
      if (
        await act(
          () =>
            api("campus", "PUT", {
              ...values,
              circle: boundaryMode === "circle" ? values.circle : undefined,
              polygon: boundaryMode === "polygon" ? draft : undefined,
            }),
          "Đã lưu ranh giới và cấu hình",
        )
      ) {
        setBoundaryOpen(false);
        setPlacingCenter(false);
      }
    } catch {
      /* Form shows validation errors. */
    }
  }
  const alertCards = (alerts: CampusAlert[]) =>
    alerts.length ? (
      <div className="alert-list">
        {alerts.map((a) => (
          <article
            className={`event ${a.resolved_at ? "resolved" : a.type}`}
            key={a.id}
          >
            <span className="event-icon">
              {a.type === "outside" ? (
                <EnvironmentOutlined />
              ) : (
                <FieldTimeOutlined />
              )}
            </span>
            <div className="event-content">
              <div className="event-heading">
                <strong>{a.user_name}</strong>
                <Tag
                  color={
                    a.resolved_at
                      ? "default"
                      : a.type === "outside"
                        ? "red"
                        : "orange"
                  }
                  bordered={false}
                >
                  {a.resolved_at
                    ? "Đã kết thúc"
                    : a.type === "outside"
                      ? "Ngoài khuôn viên"
                      : "Mất cập nhật"}
                </Tag>
              </div>
              <p>
                {a.type === "outside"
                  ? "Vị trí nằm ngoài ranh giới qua các mẫu xác nhận."
                  : "Không có mẫu vị trí mới trong thời gian cho phép."}
              </p>
              <small>
                {time(a.created_at)}
                {a.acknowledged_at ? " · Admin đã ghi nhận" : ""}
              </small>
              {a.report ? (
                <div className="report-text">
                  <strong>Báo cáo:</strong> {a.report}
                </div>
              ) : (
                <span className="no-report">
                  Chưa có báo cáo của người dùng
                </span>
              )}
            </div>
            {admin ? (
              !a.acknowledged_at && (
                <Button
                  size="small"
                  onClick={() =>
                    act(
                      () => api(`alerts/${a.id}/ack`, "POST", {}),
                      "Đã ghi nhận cảnh báo",
                    )
                  }
                >
                  Ghi nhận
                </Button>
              )
            ) : (
              <Button
                size="small"
                onClick={() => {
                  setReport(a);
                  setReportText(a.report ?? "");
                }}
              >
                {a.report ? "Sửa báo cáo" : "Gửi báo cáo"}
              </Button>
            )}
          </article>
        ))}
      </div>
    ) : (
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description="Chưa có cảnh báo"
      />
    );
  return (
    <div className="shell">
      <aside className="sidebar">
        <a
          className="brand"
          onClick={() => navigate(admin ? "overview" : "me")}
        >
          <span className="brand-symbol">
            <SafetyCertificateOutlined />
          </span>
          Campus<span>Guard</span>
        </a>
        <div className="workspace">
          <span className="workspace-icon">PH1</span>
          <div>
            <strong>Thiếu sinh quân miền Trung</strong>
            <small>Phân hiệu 1 · Pleiku</small>
          </div>
        </div>
        <div className="nav-label">KHÔNG GIAN QUẢN LÝ</div>
        <nav>
          {navigation.map((n) => (
            <button
              key={n.key}
              className={current === n.key ? "selected" : ""}
              onClick={() => navigate(n.key)}
            >
              {n.icon}
              <span>{n.label}</span>
              {n.key === "alerts" && activeAlerts.length > 0 && (
                <b>{activeAlerts.length}</b>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-note">
          <SafetyCertificateOutlined />
          <strong>Theo dõi có trách nhiệm</strong>
          <p>Vị trí được chia sẻ khi người dùng bật theo dõi và cấp quyền.</p>
        </div>
        <div className="profile">
          <Avatar style={{ background: "#e3eee8", color: "#167d68" }}>
            {me.name.charAt(0)}
          </Avatar>
          <span>
            <strong>{me.name}</strong>
            <small>{admin ? "Quản trị viên" : "Người dùng"}</small>
          </span>
          <Tooltip title="Đăng xuất">
            <Button type="text" icon={<LogoutOutlined />} onClick={logout} />
          </Tooltip>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <span>
            Không gian trường học <span className="slash">/</span>{" "}
            <strong>{title}</strong>
          </span>
          <Space>
            <span className="live">
              <i /> {error ? "Mất kết nối máy chủ" : "Máy chủ trực tuyến"}
            </span>
            <Tooltip title="Làm mới">
              <Button
                type="text"
                icon={<ReloadOutlined />}
                onClick={() => void refresh(true)}
              />
            </Tooltip>
            <Badge count={activeAlerts.length} size="small">
              <Button
                type="text"
                aria-label="Mở cảnh báo"
                icon={<BellOutlined />}
                onClick={() => navigate("alerts")}
              />
            </Badge>
            <Button
              className="mobile-logout"
              type="text"
              aria-label="Đăng xuất"
              icon={<LogoutOutlined />}
              onClick={logout}
            />
          </Space>
        </header>
        <main className="content">
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                CAMPUS GUARD / {admin ? "QUẢN TRỊ" : "CÁ NHÂN"}
              </div>
              <h1>{current === "overview" ? "Dashboard quân số" : title}</h1>
              <p>
                {current === "history"
                  ? "Tra cứu các mẫu vị trí và lượt ngoài khuôn viên để phân tích theo ngày."
                  : current === "overview"
                    ? "Quân số theo tài khoản đang hoạt động và trạng thái GPS cuối cùng. Tự cập nhật mỗi 15 giây."
                    : current === "boundary"
                      ? "Thiết lập ranh giới theo đúng hàng rào thực tế của trường."
                      : current === "people"
                        ? "Cấp tài khoản và quản lý quyền truy cập của người dùng."
                        : current === "alerts"
                          ? "Theo dõi sự kiện và báo cáo của người dùng."
                          : "Chủ động chia sẻ và kiểm tra vị trí của bạn."}
              </p>
            </div>
            <Space>
              {current === "people" ? (
                <Button
                  type="primary"
                  icon={<PlusOutlined />}
                  onClick={() => setCreateOpen(true)}
                >
                  Tạo tài khoản
                </Button>
              ) : admin &&
                (current === "overview" || current === "boundary") ? (
                <Button
                  type="primary"
                  icon={<SettingOutlined />}
                  onClick={openBoundary}
                >
                  {campus?.circle
                    ? "Kéo chỉnh bán kính"
                    : campus?.polygon.length
                      ? "Chỉnh sửa ranh giới"
                      : "Thiết lập khuôn viên"}
                </Button>
              ) : null}
            </Space>
          </div>
          {error && (
            <Alert
              type="error"
              showIcon
              title={error}
              style={{ marginBottom: 20 }}
            />
          )}
          {!state ? (
            <div className="loading-panel">
              <Spin />
            </div>
          ) : (
            <>
              {current !== "me" && campus?.boundaryNote && (
                <Alert
                  type={
                    campus.boundaryNote.startsWith("Vùng tạm")
                      ? "warning"
                      : "info"
                  }
                  showIcon
                  title={campus.boundaryNote}
                  description={
                    campus.boundaryNote.startsWith("Vùng tạm") ? (
                      <>
                        GPS được tính trong/ngoài theo vùng đang cấu hình. Admin
                        có thể đặt tâm ở nơi khác, đổi bán kính hoặc vẽ đa giác
                        theo khuôn viên thực tế.{" "}
                        {campus.circle && (
                          <a
                            href={`https://www.google.com/maps/search/?api=1&query=${campus.circle.center.lat},${campus.circle.center.lng}`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Xem tâm vùng hiện tại
                          </a>
                        )}
                        .
                      </>
                    ) : undefined
                  }
                  style={{ marginBottom: 20 }}
                />
              )}
              {current === "history" && (
                <>
                  <HistoryPanel
                    me={me}
                    people={people}
                    revision={Math.max(
                      0,
                      ...people.map((p) => p.reading?.capturedAt ?? 0),
                    )}
                  />
                  {admin && !campus?.polygon.length && (
                    <Alert
                      type="warning"
                      showIcon
                      title="Chưa lưu ranh giới trường"
                      description="Vào Khuôn viên trường để vẽ ranh giới. Các mẫu trước khi có ranh giới vẫn được lưu nhưng chưa được phân loại trong/ngoài."
                      action={
                        <Button onClick={openBoundary}>Vẽ ranh giới</Button>
                      }
                    />
                  )}
                </>
              )}
              {(current === "overview" || current === "boundary") &&
                !campus?.polygon.length && (
                  <Alert
                    type="info"
                    showIcon
                    title="Cần xác nhận ranh giới khuôn viên"
                    description="Bản đồ đang ở khu vực Pleiku, chưa phải ranh giới thực tế. Vẽ và lưu khuôn viên để bắt đầu kiểm tra vượt vùng."
                    action={
                      <Button onClick={openBoundary}>Vẽ ranh giới</Button>
                    }
                    style={{ marginBottom: 20 }}
                  />
                )}
              {current === "overview" && (
                <>
                  {!me.tracking && (
                    <Alert
                      type="info"
                      showIcon
                      title="Thiết bị đang đăng nhập chưa bật chia sẻ GPS"
                      description={
                        <>
                          <p>
                            Đăng nhập không tự bật định vị. Nếu muốn hiện vị trí
                            điện thoại này trên bản đồ, vào Vị trí của tôi và
                            bật chia sẻ.
                          </p>
                          <Button
                            onClick={() => {
                              navigate("me");
                            }}
                          >
                            Chia sẻ vị trí máy này
                          </Button>
                        </>
                      }
                      style={{ marginBottom: 20 }}
                    />
                  )}
                  <section className="stats">
                    {[
                      {
                        label: "Tổng quân số",
                        value: roster.total,
                        detail:
                          "Tài khoản học viên đang hoạt động; không gồm admin",
                        icon: <TeamOutlined />,
                        className: "blue",
                      },
                      {
                        label: "Trong khuôn viên",
                        value: roster.inside,
                        detail: "GPS xác nhận trong ranh giới",
                        icon: <CheckCircleOutlined />,
                        className: "green",
                      },
                      {
                        label: "Ngoài khuôn viên",
                        value: roster.outside,
                        detail: "Đã qua bước xác nhận",
                        icon: <EnvironmentOutlined />,
                        className: "red",
                      },
                      {
                        label: "Chưa xác định",
                        value: roster.unknown,
                        detail: "Chưa GPS, mất cập nhật hoặc đang xác nhận",
                        icon: <FieldTimeOutlined />,
                        className: "amber",
                      },
                    ].map((s) => (
                      <div className={`stat stat-${s.className}`} key={s.label}>
                        <div>
                          <span>{s.label}</span>
                          <span className={`stat-icon ${s.className}`}>
                            {s.icon}
                          </span>
                        </div>
                        <strong>{s.value.toString().padStart(2, "0")}</strong>
                        <small>{s.detail}</small>
                      </div>
                    ))}
                  </section>
                  <div className="inline-note">
                    Quân số có GPS mới: {roster.fresh} / {roster.total}. Không
                    có GPS không được tính là đã rời trường. Dữ liệu dashboard:{" "}
                    {time(state.serverTime)}.
                  </div>
                  <section className="overview-grid">
                    <div className="panel map-panel">
                      <div className="panel-heading">
                        <div>
                          <h2>Bản đồ vị trí đã nhận</h2>
                          <p>{campus?.address}</p>
                        </div>
                        <Button
                          onClick={() => {
                            setFocus(null);
                            setOverviewFitRevision((value) => value + 1);
                          }}
                        >
                          Xem tất cả vị trí
                        </Button>
                      </div>
                      <div className="map-wrap">
                        <Map
                          polygon={campus?.polygon ?? []}
                          circle={campus?.circle}
                          people={people}
                          focus={focus}
                          fitPeople
                          fitRevision={overviewFitRevision}
                          now={state.serverTime}
                          staleMinutes={campus?.policy.staleMinutes}
                        />
                        {!people.some((p) => p.reading) && (
                          <div className="map-overlay">
                            <AimOutlined /> Chưa có vị trí được chia sẻ
                          </div>
                        )}
                      </div>
                      <div className="map-legend">
                        <span>
                          <i className="dot green" />
                          Trong khuôn viên
                        </span>
                        <span>
                          <i className="dot red" />
                          Ngoài khuôn viên
                        </span>
                        <span>
                          <i className="dot amber" />
                          Mất cập nhật
                        </span>
                        <span>Rê chuột hoặc chạm điểm để xem thông tin</span>
                        <span>
                          Điểm xám = đã dừng chia sẻ; vòng tròn = sai số GPS
                        </span>
                      </div>
                    </div>
                    <div className="panel activity">
                      <div className="panel-heading">
                        <h2>Sự kiện GPS gần đây</h2>
                        <Badge count={activeAlerts.length} color="#d28d18" />
                      </div>
                      {alertCards(state.alerts.slice(0, 3))}
                      <Button
                        type="text"
                        className="view-all"
                        onClick={() => navigate("alerts")}
                      >
                        Xem tất cả sự kiện <ArrowRightOutlined />
                      </Button>
                    </div>
                  </section>
                  <section className="panel">
                    <div className="panel-heading">
                      <div>
                        <h2>Trạng thái người dùng</h2>
                        <p>
                          Chỉ hiển thị vị trí cuối cùng đã nhận, không suy đoán
                          vị trí hiện tại.
                        </p>
                      </div>
                      <Button type="text" onClick={() => navigate("people")}>
                        Quản lý tài khoản <ArrowRightOutlined />
                      </Button>
                    </div>
                    <Table
                      rowKey="id"
                      columns={peopleColumns}
                      dataSource={people.slice(0, 6)}
                      pagination={false}
                      scroll={{ x: 680 }}
                      locale={{
                        emptyText: (
                          <Empty
                            image={Empty.PRESENTED_IMAGE_SIMPLE}
                            description="Tạo tài khoản để bắt đầu kết nối người dùng"
                          />
                        ),
                      }}
                    />
                  </section>
                </>
              )}
              {current === "boundary" && (
                <div className="boundary-grid">
                  <section className="panel map-panel">
                    <div className="panel-heading">
                      <div>
                        <h2>
                          {boundaryOpen
                            ? boundaryMode === "circle"
                              ? "Kéo để chỉnh bán kính"
                              : "Đang vẽ ranh giới"
                            : "Ranh giới khuôn viên"}
                        </h2>
                        {boundaryDirty && (
                          <Tag color="gold" className="draft-status">
                            Chưa lưu
                          </Tag>
                        )}
                        <p>
                          {boundaryOpen
                            ? boundaryMode === "circle"
                              ? placingCenter
                                ? "Chạm một điểm bất kỳ trên bản đồ để đặt tâm vùng mới. Bán kính được giữ nguyên; bấm Lưu bán kính để áp dụng."
                                : "Đặt vùng ở bất kỳ đâu: di chuyển bản đồ, bấm Đặt tâm trên bản đồ rồi chạm nơi muốn chọn. Kéo ✚ để dời tâm, ↔ để đổi bán kính; bấm Lưu bán kính để áp dụng."
                              : "Nhấp lần lượt các góc theo hàng rào. Đường cuối sẽ tự nối về điểm đầu."
                            : (campus?.boundaryNote ??
                              "Ranh giới do quản trị viên thiết lập.")}
                        </p>
                      </div>
                      <Tag>
                        {(boundaryOpen ? previewCircle : campus?.circle)
                          ? `${(boundaryOpen ? previewCircle : campus?.circle)!.radiusMeters} m`
                          : `${(boundaryOpen ? previewPolygon : (campus?.polygon ?? [])).length} đỉnh`}
                      </Tag>
                    </div>
                    <Map
                      polygon={
                        boundaryOpen ? previewPolygon : (campus?.polygon ?? [])
                      }
                      circle={boundaryOpen ? previewCircle : campus?.circle}
                      onCircleChange={
                        boundaryOpen && boundaryMode === "circle" && !busy
                          ? (value) =>
                              campusForm.setFieldsValue({ circle: value })
                          : undefined
                      }
                      fitRevision={regionFitRevision}
                      onCenterPick={
                        boundaryOpen &&
                        boundaryMode === "circle" &&
                        !busy &&
                        placingCenter &&
                        previewCircle
                          ? (point) => {
                              campusForm.setFieldsValue({
                                circle: { ...previewCircle, center: point },
                              });
                              setPlacingCenter(false);
                              setRegionFitRevision((value) => value + 1);
                            }
                          : undefined
                      }
                      fitRegion
                      drawing={
                        boundaryOpen && boundaryMode === "polygon" && !busy
                      }
                      onPoint={(p) => setDraft((d) => [...d, p])}
                      focus={focus}
                    />
                    <div className="map-tools">
                      {(boundaryOpen
                        ? previewPolygon.length
                        : (campus?.polygon.length ?? 0)) >= 3 && (
                        <Button
                          onClick={() =>
                            setRegionFitRevision((value) => value + 1)
                          }
                        >
                          Xem toàn vùng
                        </Button>
                      )}
                      {boundaryOpen && boundaryMode === "circle" && (
                        <>
                          <Button
                            type={placingCenter ? "primary" : "default"}
                            aria-pressed={placingCenter}
                            disabled={!previewCircle || busy}
                            onClick={() => setPlacingCenter((value) => !value)}
                          >
                            {placingCenter
                              ? "Hủy chọn tâm"
                              : "Đặt tâm trên bản đồ"}
                          </Button>
                          <Button
                            type="primary"
                            loading={busy}
                            disabled={!previewCircle}
                            onClick={saveBoundary}
                          >
                            Lưu bán kính
                          </Button>
                        </>
                      )}
                      <Button
                        icon={<AimOutlined />}
                        onClick={() =>
                          navigator.geolocation?.getCurrentPosition(
                            (p) =>
                              setFocus({
                                lat: p.coords.latitude,
                                lng: p.coords.longitude,
                              }),
                            () =>
                              message.error(
                                "Không lấy được vị trí. Kiểm tra quyền GPS.",
                              ),
                          )
                        }
                      >
                        Đến vị trí của tôi
                      </Button>
                      {boundaryOpen && boundaryMode === "polygon" && (
                        <>
                          <Button
                            icon={<UndoOutlined />}
                            disabled={!draft.length}
                            onClick={() => setDraft((d) => d.slice(0, -1))}
                          >
                            Bỏ điểm cuối
                          </Button>
                          <Button
                            danger
                            disabled={!draft.length}
                            onClick={() => setDraft([])}
                          >
                            Vẽ lại
                          </Button>
                        </>
                      )}
                    </div>
                  </section>
                  <section className="panel boundary-settings">
                    <div className="panel-heading">
                      <h2>
                        {boundaryOpen
                          ? "Thiết lập khuôn viên"
                          : "Cách hệ thống đo"}
                      </h2>
                    </div>
                    {boundaryOpen ? (
                      <>
                        <Form
                          form={campusForm}
                          layout="vertical"
                          disabled={busy}
                        >
                          <Form.Item label="Cách xác định vùng">
                            <Select
                              aria-label="Cách xác định vùng"
                              value={boundaryMode}
                              onChange={(mode) => {
                                setBoundaryMode(mode);
                                setPlacingCenter(false);
                              }}
                              options={[
                                { value: "circle", label: "Tâm và bán kính" },
                                {
                                  value: "polygon",
                                  label: "Vẽ đa giác theo hàng rào",
                                },
                              ]}
                            />
                          </Form.Item>
                          {boundaryMode === "circle" && (
                            <>
                              <Form.Item
                                name={["circle", "radiusMeters"]}
                                label="Bán kính khuôn viên (m)"
                                rules={[
                                  {
                                    required: true,
                                    type: "number",
                                    min: 50,
                                    max: 3000,
                                    message: "Nhập bán kính từ 50 đến 3.000 m.",
                                  },
                                ]}
                                extra="Có thể tăng lên 500 m, 1.000 m hoặc tối đa 3.000 m. Mở rộng vùng sẽ làm ít điểm bị tính là ngoài vùng hơn."
                              >
                                <InputNumber
                                  aria-label="Bán kính khuôn viên (m)"
                                  min={50}
                                  max={3000}
                                  step={50}
                                  style={{ width: "100%" }}
                                />
                              </Form.Item>
                              <div className="form-pair">
                                <Form.Item
                                  name={["circle", "center", "lat"]}
                                  label="Vĩ độ tâm"
                                  rules={[
                                    {
                                      required: true,
                                      type: "number",
                                      min: -85,
                                      max: 85,
                                    },
                                  ]}
                                >
                                  <InputNumber
                                    aria-label="Vĩ độ tâm"
                                    min={-85}
                                    max={85}
                                    step={0.000001}
                                  />
                                </Form.Item>
                                <Form.Item
                                  name={["circle", "center", "lng"]}
                                  label="Kinh độ tâm"
                                  rules={[
                                    {
                                      required: true,
                                      type: "number",
                                      min: -180,
                                      max: 180,
                                    },
                                  ]}
                                >
                                  <InputNumber
                                    aria-label="Kinh độ tâm"
                                    min={-180}
                                    max={180}
                                    step={0.000001}
                                  />
                                </Form.Item>
                              </div>
                            </>
                          )}
                          <Form.Item
                            label="Tên trường"
                            name="name"
                            rules={[{ required: true }]}
                          >
                            <Input />
                          </Form.Item>
                          <Form.Item
                            label="Địa chỉ"
                            name="address"
                            rules={[{ required: true }]}
                          >
                            <Input.TextArea rows={2} />
                          </Form.Item>
                          <div className="form-pair">
                            <Form.Item
                              label="Vùng đệm (m)"
                              name={["policy", "buffer"]}
                              rules={[{ required: true }]}
                            >
                              <InputNumber min={0} max={100} />
                            </Form.Item>
                            <Form.Item
                              label="Sai số tối đa (m)"
                              name={["policy", "maxAccuracy"]}
                              rules={[{ required: true }]}
                            >
                              <InputNumber min={5} max={200} />
                            </Form.Item>
                            <Form.Item
                              label="Xác nhận ngoài (giây)"
                              name={["policy", "confirmSeconds"]}
                              rules={[{ required: true }]}
                            >
                              <InputNumber min={10} max={300} />
                            </Form.Item>
                            <Form.Item
                              label="Mất cập nhật (phút)"
                              name={["policy", "staleMinutes"]}
                              rules={[{ required: true }]}
                            >
                              <InputNumber min={2} max={60} />
                            </Form.Item>
                          </div>
                        </Form>
                        <Alert
                          type="info"
                          title="Không thể đo chính xác đến hàng rào"
                          description="Điểm nằm sát ranh giới hoặc sai số GPS lớn sẽ được đánh dấu chưa rõ, tránh cảnh báo nhầm."
                        />
                        <Space style={{ marginTop: 20 }}>
                          <Button
                            type="primary"
                            disabled={
                              boundaryMode === "circle"
                                ? !previewCircle
                                : draft.length < 3
                            }
                            loading={busy}
                            onClick={saveBoundary}
                          >
                            Lưu khuôn viên
                          </Button>
                          <Button
                            disabled={busy}
                            onClick={() => {
                              setBoundaryOpen(false);
                              setPlacingCenter(false);
                            }}
                          >
                            Hủy
                          </Button>
                        </Space>
                      </>
                    ) : (
                      <>
                        <ol className="steps">
                          <li>
                            <strong>
                              {campus?.circle
                                ? `Bán kính hiện tại: ${campus.circle.radiusMeters} m`
                                : "Vẽ theo hàng rào"}
                            </strong>
                            <p>
                              {campus?.circle
                                ? `Tâm ${campus.circle.center.lat.toFixed(7)}, ${campus.circle.center.lng.toFixed(7)}. Dùng khoảng cách đến tâm để tính trong/ngoài. Có thể chỉnh tâm và bán kính hoặc đổi sang đa giác.`
                                : "Lưu đường đa giác bao quanh khuôn viên, bao gồm các góc và cổng trường."}
                            </p>
                          </li>
                          <li>
                            <strong>Xét cả sai số GPS</strong>
                            <p>
                              Chỉ tính ngoài khi khoảng cách tới ranh giới lớn
                              hơn sai số GPS + vùng đệm {campus?.policy.buffer}{" "}
                              m.
                            </p>
                          </li>
                          <li>
                            <strong>Xác nhận nhiều mẫu</strong>
                            <p>
                              Ít nhất 2 mẫu liên tiếp, kéo dài{" "}
                              {campus?.policy.confirmSeconds} giây. Mẫu không rõ
                              sẽ ngắt chuỗi xác nhận.
                            </p>
                          </li>
                          <li>
                            <strong>Phát hiện mất cập nhật</strong>
                            <p>
                              Máy chủ tạo cảnh báo sau{" "}
                              {campus?.policy.staleMinutes} phút không có vị trí
                              mới.
                            </p>
                          </li>
                        </ol>
                        <Button block type="primary" onClick={openBoundary}>
                          {campus?.circle
                            ? "Kéo chỉnh bán kính"
                            : "Chỉnh sửa ranh giới"}
                        </Button>
                      </>
                    )}
                  </section>
                </div>
              )}
              {current === "people" && (
                <section className="panel">
                  <div className="panel-heading">
                    <h2>
                      Danh sách tài khoản{" "}
                      <span className="count">{people.length}</span>
                    </h2>
                    <Input.Search
                      aria-label="Tìm người dùng"
                      placeholder="Tìm tên hoặc email…"
                      style={{ maxWidth: 280 }}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                  </div>
                  <Table
                    rowKey="id"
                    columns={peopleColumns}
                    dataSource={visiblePeople}
                    pagination={{ pageSize: 10, showSizeChanger: false }}
                    scroll={{ x: 760 }}
                  />
                </section>
              )}
              {current === "alerts" && (
                <section className="panel">
                  {admin && (
                    <div className="inline-note">
                      <strong>Giám sát tự động:</strong>{" "}
                      {state.monitor?.lastRunAt
                        ? "Nhịp kiểm tra gần nhất " +
                          time(state.monitor.lastRunAt)
                        : "Đang chờ lần kiểm tra đầu tiên."}{" "}
                      Lịch kiểm tra mục tiêu 5 phút/lần và có thể trễ.{" "}
                      {state.monitor?.lastRunAt &&
                      Date.now() - state.monitor.lastRunAt > 15 * 60000
                        ? "Cần kiểm tra lại lịch giám sát."
                        : ""}
                    </div>
                  )}
                  <div className="panel-heading">
                    <div>
                      <h2>Sự kiện và báo cáo</h2>
                      <p>
                        {activeAlerts.length} cảnh báo đang hoạt động ·{" "}
                        {state.alerts.length} sự kiện gần nhất
                      </p>
                    </div>
                  </div>
                  <div className="inline-note">
                    Hệ thống lưu sự kiện để xem lại và phân tích; không gửi
                    thông báo đẩy.
                  </div>
                  {alertCards(state.alerts)}
                </section>
              )}
              {current === "me" && (
                <>
                  <div className="personal-grid">
                    <section className="panel personal-card">
                      <div className="personal-pin">
                        <AimOutlined />
                      </div>
                      <h2>Vị trí của {me.name}</h2>
                      <Status person={me} />
                      <p className="muted">
                        Lần cập nhật cuối:{" "}
                        {time(me.reading?.capturedAt ?? null)}
                      </p>
                      {me.reading && (
                        <div className="coordinate">
                          <span>Vĩ độ / kinh độ</span>
                          <strong>
                            {me.reading.lat.toFixed(6)},{" "}
                            {me.reading.lng.toFixed(6)}
                          </strong>
                          <span>
                            Sai số ước tính: ±{Math.round(me.reading.accuracy)}{" "}
                            m
                          </span>
                        </div>
                      )}
                      {gps.error && (
                        <Alert
                          type="error"
                          showIcon
                          title={gps.error}
                          style={{ marginBottom: 16 }}
                        />
                      )}
                      {!me.tracking ? (
                        <>
                          <Alert
                            type="info"
                            showIcon
                            title="Chia sẻ vị trí đang tắt"
                            description={
                              me.reading
                                ? "Bản đồ đang hiển thị vị trí cuối đã lưu. Bật chia sẻ để lấy GPS mới từ điện thoại đang dùng."
                                : "Đăng nhập chưa tự gửi GPS. Đồng ý chia sẻ và bấm nút bên dưới để lấy vị trí điện thoại này."
                            }
                            style={{ marginBottom: 16 }}
                          />
                          <Checkbox
                            checked={consent}
                            onChange={(e) => setConsent(e.target.checked)}
                          >
                            Tôi đồng ý chia sẻ vị trí với quản trị viên để quản
                            lý khuôn viên trường.
                          </Checkbox>
                          <Button
                            type="primary"
                            size="large"
                            block
                            disabled={!consent}
                            loading={busy}
                            icon={<AimOutlined />}
                            onClick={() =>
                              act(
                                () =>
                                  api("tracking", "POST", {
                                    enabled: true,
                                    consent,
                                  }),
                                "Đã bật chia sẻ. Đang lấy mẫu GPS đầu tiên…",
                              )
                            }
                          >
                            Bật chia sẻ và lấy GPS
                          </Button>
                        </>
                      ) : (
                        <>
                          <Alert
                            type={
                              gps.phase === "error"
                                ? "error"
                                : me.reading
                                  ? "success"
                                  : "info"
                            }
                            showIcon
                            title={
                              gps.phase === "locating"
                                ? "Đang lấy vị trí từ thiết bị…"
                                : gps.phase === "sending"
                                  ? "Đang gửi GPS lên máy chủ…"
                                  : gps.phase === "error"
                                    ? "Chưa gửi được mẫu GPS mới"
                                    : me.reading
                                      ? "Máy chủ đã lưu vị trí của bạn"
                                      : "Đang chờ mẫu GPS đầu tiên"
                            }
                            description={
                              me.reading
                                ? `GPS: ${time(me.reading.capturedAt)} · Máy chủ nhận: ${time(me.lastReceivedAt ?? null)}. Mẫu tiếp theo sau khoảng 60 giây.`
                                : "Bật chia sẻ chưa đồng nghĩa đã có GPS. Hãy cấp quyền vị trí khi trình duyệt hỏi."
                            }
                          />
                          <Button
                            block
                            type="primary"
                            icon={<ReloadOutlined />}
                            loading={gps.loading}
                            onClick={() => void gps.captureNow()}
                          >
                            Cập nhật GPS ngay
                          </Button>
                          <Checkbox
                            checked={keepScreenOn}
                            disabled={!screenAwake.supported}
                            onChange={(event) =>
                              setKeepScreenOn(event.target.checked)
                            }
                          >
                            Giữ màn hình sáng khi đang chia sẻ
                          </Checkbox>
                          <p className="muted" role="status">
                            {screenAwake.active
                              ? "Đang giữ màn hình sáng khi trang hiển thị. Đây không phải định vị nền."
                              : screenAwake.error ||
                                (!screenAwake.supported
                                  ? "Trình duyệt này chưa hỗ trợ giữ màn hình sáng."
                                  : "Tùy chọn này chỉ có tác dụng khi trang đang hiển thị; hệ điều hành vẫn có thể thu hồi.")}
                          </p>
                          <Button
                            block
                            danger
                            loading={busy}
                            onClick={() =>
                              act(
                                () =>
                                  api("tracking", "POST", {
                                    enabled: false,
                                    consent: false,
                                  }),
                                "Đã dừng chia sẻ vị trí",
                              )
                            }
                          >
                            Dừng chia sẻ vị trí
                          </Button>
                        </>
                      )}
                      <small>
                        Quyền vị trí phải được cấp trong trình duyệt. Điện thoại
                        truy cập qua HTTPS.
                      </small>
                      <details className="gps-help">
                        <summary>Hướng dẫn GPS và giới hạn web</summary>
                        <Alert
                          showIcon
                          type="warning"
                          title="Giới hạn của phiên bản web"
                          description="Giữ trang mở để gửi vị trí, mục tiêu mỗi 60 giây. Khóa màn hình hoặc chuyển ứng dụng có thể dừng cập nhật. Cài web/PWA vào màn hình chính cũng không bảo đảm GPS chạy nền."
                        />
                        {/iPhone|iPad/.test(navigator.userAgent) && (
                          <Alert
                            type="info"
                            showIcon
                            title="Cấp quyền GPS trên iPhone / Safari"
                            description="Chọn Cho phép khi website hỏi vị trí. Nếu đã chặn: vào Cài đặt → Quyền riêng tư & Bảo mật → Dịch vụ định vị → Trang web Safari; cho phép khi dùng và bật Vị trí chính xác. Giữ trang hiển thị để gửi GPS."
                          />
                        )}
                        {campus?.boundaryNote && (
                          <Alert
                            showIcon
                            type="info"
                            title={campus.boundaryNote}
                          />
                        )}
                      </details>
                    </section>
                    <section className="panel map-panel">
                      <div className="panel-heading">
                        <h2>Vị trí và khuôn viên</h2>
                        <Button
                          size="small"
                          disabled={!me.reading}
                          onClick={() => setFocus(me.reading)}
                          icon={<AimOutlined />}
                        >
                          Về vị trí tôi
                        </Button>
                      </div>
                      <div className="map-wrap">
                        <Map
                          polygon={campus?.polygon ?? []}
                          circle={campus?.circle}
                          people={[me]}
                          focus={focus ?? me.reading}
                          now={state.serverTime}
                          staleMinutes={campus?.policy.staleMinutes}
                        />
                        {!me.reading && (
                          <div className="map-overlay">
                            <AimOutlined />{" "}
                            {me.tracking
                              ? "Chưa nhận được GPS. Kiểm tra quyền vị trí và bấm Cập nhật GPS ngay."
                              : "Chưa có GPS. Bật chia sẻ để đưa vị trí lên bản đồ."}
                          </div>
                        )}
                      </div>
                      <div className="map-legend">
                        Rê chuột hoặc chạm điểm vị trí để xem thông tin. Vòng
                        tròn biểu thị sai số GPS.
                      </div>
                    </section>
                  </div>
                </>
              )}
            </>
          )}
          <footer>
            Campus Guard <span>Phân hiệu 1 · Thiếu sinh quân miền Trung</span>
            <span>Thời gian hiển thị: Việt Nam (UTC+7)</span>
          </footer>
        </main>
      </div>
      <Modal
        open={createOpen}
        title="Tạo tài khoản người dùng"
        okText="Tạo tài khoản"
        cancelText="Hủy"
        confirmLoading={busy}
        onCancel={() => setCreateOpen(false)}
        onOk={async () => {
          try {
            const values = await userForm.validateFields();
            if (
              await act(() => api("users", "POST", values), "Đã tạo tài khoản")
            ) {
              setCreateOpen(false);
              userForm.resetFields();
            }
          } catch {
            /* Field validation. */
          }
        }}
      >
        <p className="muted">
          Người dùng đăng nhập bằng email và mật khẩu bạn cung cấp.
        </p>
        <Form form={userForm} layout="vertical">
          <Form.Item
            name="name"
            label="Họ tên"
            rules={[{ required: true, min: 2 }]}
          >
            <Input autoComplete="off" />
          </Form.Item>
          <Form.Item
            name="email"
            label="Email"
            rules={[{ required: true, type: "email" }]}
          >
            <Input autoComplete="off" />
          </Form.Item>
          <Form.Item
            name="password"
            label="Mật khẩu"
            rules={[
              {
                required: true,
                min: 12,
                message: "Mật khẩu ít nhất 12 ký tự.",
              },
            ]}
          >
            <Input.Password autoComplete="new-password" />
          </Form.Item>
        </Form>
      </Modal>
      <Modal
        open={!!report}
        title="Báo cáo cho quản trị viên"
        okText="Gửi báo cáo"
        cancelText="Hủy"
        confirmLoading={busy}
        onCancel={() => setReport(null)}
        onOk={async () => {
          if (!report) return;
          if (
            await act(
              () =>
                api(`alerts/${report.id}/report`, "POST", {
                  report: reportText,
                }),
              "Đã gửi báo cáo",
            )
          )
            setReport(null);
        }}
      >
        <p>
          Giải thích tình huống liên quan đến cảnh báo lúc{" "}
          {time(report?.created_at ?? null)}.
        </p>
        <Input.TextArea
          aria-label="Nội dung báo cáo"
          value={reportText}
          onChange={(e) => setReportText(e.target.value)}
          rows={5}
          maxLength={2000}
          showCount
          placeholder="Nhập ít nhất 5 ký tự…"
        />
      </Modal>
    </div>
  );
}
