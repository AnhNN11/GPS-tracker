"use client";
import { useEffect, useState } from "react";
import { Alert, Button, ConfigProvider, Form, Input, Spin } from "antd";
import { SafetyCertificateOutlined } from "@ant-design/icons";
export default function AdminSetup() {
  const [form] = Form.useForm();
  const [status, setStatus] = useState<{
      required: boolean;
      tokenReady: boolean;
    } | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    const code = new URLSearchParams(window.location.hash.slice(1)).get(
      "setup",
    );
    if (code) {
      form.setFieldValue("code", code);
      window.history.replaceState(null, "", window.location.pathname);
    }
    fetch("/api/setup/status", { cache: "no-store" })
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error);
        setStatus(data);
      })
      .catch((e) => setError(e.message));
  }, [form]);
  async function submit(values: {
    code: string;
    name: string;
    email: string;
    password: string;
  }) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.error || "Không thể tạo quản trị viên.");
      window.location.assign("/");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <ConfigProvider
      theme={{
        token: { colorPrimary: "#167d68", borderRadius: 10, controlHeight: 44 },
      }}
    >
      <main className="setup-page">
        <section className="setup-card">
          <div className="personal-pin">
            <SafetyCertificateOutlined />
          </div>
          <div className="eyebrow">CAMPUS GUARD / KHỞI TẠO</div>
          <h1>Tạo quản trị viên đầu tiên</h1>
          <p className="muted">
            Thiết lập tài khoản ngay trên website. Mã thiết lập chỉ dùng được
            một lần.
          </p>
          {error && <Alert showIcon type="error" title={error} />}
          {!status && !error ? (
            <Spin />
          ) : status && !status.required ? (
            <>
              <Alert
                showIcon
                type="success"
                title="Hệ thống đã có quản trị viên"
                description="Liên kết thiết lập không còn sử dụng được."
              />
              <Button block type="primary" href="/">
                Về trang đăng nhập
              </Button>
            </>
          ) : status && !status.tokenReady ? (
            <Alert
              type="warning"
              title="Cần mã thiết lập từ chủ sở hữu"
              description="Chủ sở hữu có thể cấu hình ADMIN_SETUP_TOKEN (ít nhất 32 ký tự ngẫu nhiên) trong Environment Variables trên Vercel rồi redeploy, hoặc dùng mã thiết lập đã cấp riêng."
            />
          ) : (
            status && (
              <Form
                form={form}
                layout="vertical"
                onFinish={submit}
                requiredMark={false}
              >
                <Form.Item
                  name="code"
                  label="Mã thiết lập"
                  rules={[
                    {
                      required: true,
                      min: 32,
                      message: "Nhập mã thiết lập được cấp riêng.",
                    },
                  ]}
                >
                  <Input.Password autoComplete="off" />
                </Form.Item>
                <Form.Item
                  name="name"
                  label="Họ tên quản trị viên"
                  rules={[{ required: true, min: 2 }]}
                >
                  <Input autoComplete="name" />
                </Form.Item>
                <Form.Item
                  name="email"
                  label="Email đăng nhập"
                  rules={[{ required: true, type: "email" }]}
                >
                  <Input autoComplete="username" />
                </Form.Item>
                <Form.Item
                  name="password"
                  label="Mật khẩu"
                  rules={[
                    {
                      required: true,
                      min: 12,
                      message: "Mật khẩu cần ít nhất 12 ký tự.",
                    },
                  ]}
                >
                  <Input.Password autoComplete="new-password" />
                </Form.Item>
                <Form.Item
                  name="confirm"
                  label="Nhập lại mật khẩu"
                  dependencies={["password"]}
                  rules={[
                    { required: true },
                    ({ getFieldValue }) => ({
                      validator(_, value) {
                        return value === getFieldValue("password")
                          ? Promise.resolve()
                          : Promise.reject(
                              new Error("Mật khẩu nhập lại chưa khớp."),
                            );
                      },
                    }),
                  ]}
                >
                  <Input.Password autoComplete="new-password" />
                </Form.Item>
                <Button block type="primary" htmlType="submit" loading={busy}>
                  Tạo tài khoản và vào quản trị
                </Button>
              </Form>
            )
          )}
          <Button block type="text" href="/">
            Về trang đăng nhập
          </Button>
        </section>
      </main>
    </ConfigProvider>
  );
}
