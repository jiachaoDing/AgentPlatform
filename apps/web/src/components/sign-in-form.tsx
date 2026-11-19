import { Button } from "@agent-platform/ui/components/button";
import { Input } from "@agent-platform/ui/components/input";
import { Label } from "@agent-platform/ui/components/label";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useNavigate } from "react-router";
import { authClient } from "@/lib/auth-client";
import { queryClient } from "@/utils/orpc";

const schema = z.object({
  email: z.email("请输入有效的邮箱地址"),
  password: z.string().min(1, "请输入密码"),
});
export default function SignInForm() {
  const navigate = useNavigate();
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema) });
  return (
    <main className="page login-page">
      <div className="login-intro">
        <span className="eyebrow">AGENT PLATFORM</span>
        <h1>
          让专业能力，
          <br />
          成为你的日常工具。
        </h1>
        <p>在同一个工作空间，连接工具、委托 Agent、追溯每一次执行。</p>
      </div>
      <section className="login-card">
        <h2>登录你的工作空间</h2>
        <p>使用管理员邀请的账号继续。</p>
        <form
          onSubmit={handleSubmit(async (values) => {
            try {
              const result = await authClient.signIn.email(values);
              if (result.error) {
                setError("root", {
                  message: "登录失败，请检查账号和密码后重试。",
                });
                return;
              }
              queryClient.clear();
              navigate("/");
            } catch {
              setError("root", {
                message: "暂时无法连接登录服务，请稍后重试。",
              });
            }
          })}
        >
          <Label htmlFor="email">邮箱地址</Label>
          <Input
            id="email"
            type="email"
            autoComplete="username"
            {...register("email")}
            aria-invalid={!!errors.email}
          />
          {errors.email && <p role="alert">{errors.email.message}</p>}
          <Label htmlFor="password">密码</Label>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            {...register("password")}
            aria-invalid={!!errors.password}
          />
          {errors.password && <p role="alert">{errors.password.message}</p>}
          {errors.root && <p role="alert">{errors.root.message}</p>}
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? "正在登录…" : "登录"}
          </Button>
        </form>
        <small>还没有账号？请联系平台管理员。</small>
      </section>
    </main>
  );
}
