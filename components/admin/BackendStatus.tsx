"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/Button";
import { clearToken, readToken } from "@/lib/auth/token";
import {
  autoDetectBackend,
  backendBase,
  CANDIDATE_BASES,
  connectionSummary,
  envBackendBase,
  getConnectionState,
  isLocalBase,
  looksLikeBase,
  overrideBackendBase,
  refreshConnection,
  setBackendOverride,
  startConnectionWatch,
  subscribeConnection,
  type ConnectionState,
} from "@/lib/backend/connection";

/**
 * 后端与数据库的**真实连接状态**，以及"连不上时手动指定地址"的入口。
 *
 * ## 为什么要有它
 *
 * 之前的提示只看环境变量：后端没跑、地址填错、端口换了，界面都照样说"已连接后端"，
 * 于是人只能靠猜（这一天真的发生过：前端在 3001、后端在 4000，人却在另一个项目的
 * 页面上反复试口令）。现在这个组件显示的是**探活结果**，并且把"连到哪儿、怎么改"
 * 摆在明面上。
 *
 * ## 状态怎么来的（不猜）
 *
 *   `GET /health` → 服务活着，且**自报为本系统的后端**（service = nexgenedu-server）；
 *   已登录时再问 `GET /api/status` → 数据库结构版本、各表条数、最近一次备份。
 *   拿不到就如实说"未登录，数据库细节看不到"，而不是含糊地说"正常"。
 *
 * ## 改地址为什么要刷新
 *
 * `api` 这个对象是在**页面加载时**决定"本地实现还是远端代理"的，所以改完地址需要刷新
 * 才全局生效。组件里明确提示这一点，避免出现"界面说改了、请求还发往旧地址"的困惑。
 */
export function BackendStatus({ compact = false }: { compact?: boolean }) {
  const state = useSyncExternalStore(
    subscribeConnection,
    getConnectionState,
    getConnectionState,
  );
  const [open, setOpen] = useState(false);

  // 定时复查（30 秒）＋ 切回页面时立刻查一次；只允许一个定时器（内部引用计数）
  useEffect(() => startConnectionWatch(readToken), []);

  // 首次挂载就查一次；地址变了（手动填/自动探到）也再查
  useEffect(() => {
    void refreshConnection({ token: readToken() });
  }, []);

  const [draft, setDraft] = useState("");
  const [notice, setNotice] = useState("");

  const onAutoDetect = useCallback(async () => {
    setNotice("正在探测本机常见端口…");
    const found = await autoDetectBackend();
    if (found === null) {
      setNotice(`没找到后端。已试过：${CANDIDATE_BASES.join("、")}`);
      void refreshConnection({ token: readToken(), autoDetect: false });
      return;
    }
    setBackendOverride(found.base);
    setNotice(`已找到并记住：${found.base}（刷新页面后全局生效）`);
    void refreshConnection({ token: readToken(), autoDetect: false });
  }, []);

  const onUseDraft = useCallback(() => {
    if (!looksLikeBase(draft)) {
      setNotice("地址要写成 http://主机:端口 的样子，例如 http://localhost:4000");
      return;
    }
    setBackendOverride(draft);
    setNotice(
      isLocalBase(draft)
        ? `已切到 ${draft.trim()}（刷新页面后全局生效）`
        : `已切到 ${draft.trim()} —— 注意：这是别的机器，登录口令会发到那台机器。刷新页面后全局生效。`,
    );
    void refreshConnection({ token: readToken(), autoDetect: false });
  }, [draft]);

  const onReset = useCallback(() => {
    setBackendOverride(null);
    setNotice(
      envBackendBase() === ""
        ? "已清除手动地址（当前没有构建期地址，将尝试自动探测）"
        : `已清除手动地址，回到构建期地址：${envBackendBase()}`,
    );
    void refreshConnection({ token: readToken() });
  }, []);

  const tone = toneOf(state);
  const summary = connectionSummary(state);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs transition-colors ${tone.badge}`}
        title="点开看后端与数据库的连接状态、或手动指定地址"
      >
        <span className={`inline-block h-1.5 w-1.5 rounded-full ${tone.dot}`} aria-hidden />
        <span className={compact ? "max-sm:hidden" : ""}>{summary}</span>
      </button>

      {open && (
        <div className="absolute right-0 z-30 mt-2 w-80 rounded-md border border-ink-200 bg-white p-3 text-xs shadow-lg">
          <p className="font-medium text-ink-800">后端与数据库</p>

          <dl className="mt-2 space-y-1 text-ink-600">
            <div className="flex gap-2">
              <dt className="shrink-0 text-ink-400">地址</dt>
              <dd className="min-w-0 break-all font-mono">{backendBase() === "" ? "（未配置）" : backendBase()}</dd>
            </div>
            {overrideBackendBase() !== null && (
              <div className="flex gap-2">
                <dt className="shrink-0 text-ink-400">来源</dt>
                <dd>界面手动指定（优先于构建期地址）</dd>
              </div>
            )}
            {envBackendBase() !== "" && (
              <div className="flex gap-2">
                <dt className="shrink-0 text-ink-400">构建期</dt>
                <dd className="min-w-0 break-all font-mono">{envBackendBase()}</dd>
              </div>
            )}
            <div className="flex gap-2">
              <dt className="shrink-0 text-ink-400">状态</dt>
              <dd className="min-w-0">
                {summary}
                {state.status === "down" && (
                  <span className="mt-1 block leading-relaxed text-danger-600">{state.reason}</span>
                )}
                {state.status === "ok" && (
                  <span className="mt-1 block leading-relaxed">
                    库文件 <span className="font-mono">{state.db}</span>
                    {state.database.latestBackup === null ? (
                      <span className="mt-1 block text-warning-600">最近没有备份记录</span>
                    ) : (
                      <span className="mt-1 block text-ink-500">
                        最近备份 <span className="font-mono">{state.database.latestBackup}</span>
                      </span>
                    )}
                  </span>
                )}
                {state.status === "ready" && (
                  <span className="mt-1 block leading-relaxed text-ink-500">
                    {/*
                      三种原因分开写。**"登录已失效"要给出下一步**（一个按钮），
                      而不是只说一句状态 —— 人会卡在"明明登录了却说我未登录"里。
                    */}
                    {state.dbReason === "expired" ? (
                      <>
                        会话已失效（后端重启过，或闲置超时）—— 服务端已经不认这个令牌了，
                        因此看不到数据库结构版本与各表条数。
                        <button
                          type="button"
                          onClick={() => {
                            clearToken();
                            window.location.assign("/admin/login");
                          }}
                          className="ml-1 rounded border border-ink-300 px-2 py-0.5 text-xs text-ink-700 transition-colors hover:border-brand-400 hover:text-brand-700"
                        >
                          重新登录
                        </button>
                      </>
                    ) : state.dbReason === "unreachable" ? (
                      <>
                        服务在（库文件 <span className="font-mono">{state.db}</span>），
                        但这次请求没拿到数据库细节（网络或服务端一时的问题）—— 点「重新检查」再试一次。
                      </>
                    ) : (
                      <>
                        服务在（库文件 <span className="font-mono">{state.db}</span>），
                        登录后才能看到数据库结构版本与各表条数。
                      </>
                    )}
                  </span>
                )}
              </dd>
            </div>
          </dl>

          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => void refreshConnection({ token: readToken(), autoDetect: false })}
            >
              重新检查
            </Button>
            <Button size="sm" variant="outline" onClick={() => void onAutoDetect()}>
              自动探测本机
            </Button>
            <Button size="sm" variant="outline" onClick={onReset}>
              恢复默认
            </Button>
          </div>

          <label className="mt-3 block">
            <span className="text-ink-600">手动指定地址</span>
            <input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="http://localhost:4000"
              className="mt-1 w-full rounded-md border border-ink-300 bg-white px-2 py-1.5 font-mono text-xs text-ink-900 outline-none focus:border-brand-500"
            />
          </label>
          <div className="mt-2 flex items-center gap-2">
            <Button size="sm" onClick={onUseDraft}>
              使用这个地址
            </Button>
            <span className="text-ink-400">改完请刷新页面，全局生效</span>
          </div>

          {notice !== "" && <p className="mt-2 leading-relaxed text-ink-500">{notice}</p>}

          <p className="mt-3 border-t border-ink-100 pt-2 leading-relaxed text-ink-400">
            自动探测只认**自报为本系统**的后端（端口上跑着别的程序时不会误判）。
            填非本机地址时请留意：登录口令会发到那个地址。
          </p>
        </div>
      )}
    </div>
  );
}

/** 状态 → 颜色（绿=通、黄=在检查/未登录、红=连不上）。 */
function toneOf(state: ConnectionState): { badge: string; dot: string } {
  switch (state.status) {
    case "ok":
      return { badge: "border-brand-200 bg-brand-50 text-brand-800", dot: "bg-brand-600" };
    case "ready":
      return { badge: "border-ink-200 bg-ink-50 text-ink-600", dot: "bg-warning-500" };
    case "checking":
    case "idle":
      return { badge: "border-ink-200 bg-ink-50 text-ink-500", dot: "bg-ink-300" };
    case "down":
      return { badge: "border-danger-100 bg-danger-50 text-danger-600", dot: "bg-danger-500" };
  }
}
