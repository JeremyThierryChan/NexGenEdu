"use client";

import { useCallback, useRef, useState } from "react";

/**
 * **一次写操作的提示**：跑、失败就把服务端的原话显示出来、并把"进行中"复位。
 *
 * ## 为什么要有它（这不是"多一层抽象"，是补一个真实的洞）
 *
 * 审计实测：界面上有一整片写操作是**裸 `await`**（`await api.students.remove(...)`、
 * `void onRenew(...)`、`await api.homework.create(...)`…），于是一次 403/400/409 会变成
 * **无人接的 Promise 拒绝**：提示不出现、按钮永久停在"保存中…"、整块面板被 `disabled` 冻住
 * —— 用户看到的只是"点了没反应"，然后开始反复点。
 *
 * 更糟的是失败的原因往往**写在服务端那句话里**（"课时不足：某某还能排 3 节"
 * "这件事需要 招生老师 或 财务管理员"），裸 await 把它丢掉了，等于白写。
 *
 * 所以这里把"跑一次写操作"的正确收尾固定成一处：**显示服务端原话（或兜底一句）、
 * 复位 pending、把异常咽在界面层（不往上抛）**。各处只要把 `await api.x.y()` 换成
 * `await notice.run(() => api.x.y())` 就补齐了。
 *
 * ## 两种情况分开说
 *
 * - `error`：失败的原因，`role="alert"`（读屏会立刻念）；
 * - `message`：成功的一句人话（可选，很多动作界面上本身就看得出来，不必都写）。
 *
 * 两者互斥：开始新动作时清空、成功时清掉上一次的错误。
 */
export type ActionNotice = {
  error: string;
  message: string;
  /** 这一轮动作还在跑（给按钮的 `aria-disabled` 用）。 */
  pending: boolean;
  /** 清掉两条提示（例如用户改了表单）。 */
  clear: () => void;
  /** 只写一条成功提示。 */
  succeed: (text: string) => void;
  /** 只写一条失败提示。 */
  fail: (text: string) => void;
  /**
   * 跑一次写操作。
   *
   * - 成功：清掉错误，`done` 返回字符串就当作成功提示显示（返回 `null`/`undefined` 就什么都不显示）；
   * - 失败：把服务端原话显示出来，**返回 `null`**（调用方据此决定要不要继续后面的步骤，例如刷新列表）。
   */
  run: <T>(action: () => Promise<T>, done?: (value: T) => string | null | undefined) => Promise<T | null>;
};

export function useActionNotice(): ActionNotice {
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  /**
   * 组件是否还挂着。
   *
   * 为什么需要：动作是异步的，人可能在它回来之前就换了页面 ——
   * 那时 `setState` 会在一个已经卸载的组件上执行（React 会警告，且状态永远不会有人看到）。
   * 这是审计里"点了没反应"的近亲：不是没反应，而是反应落在了别的地方。
   */
  const alive = useRef(true);

  const clear = useCallback((): void => {
    setError("");
    setMessage("");
  }, []);

  const succeed = useCallback((text: string): void => {
    setError("");
    setMessage(text);
  }, []);

  const fail = useCallback((text: string): void => {
    setMessage("");
    setError(text);
  }, []);

  const run = useCallback(
    async <T,>(action: () => Promise<T>, done?: (value: T) => string | null | undefined): Promise<T | null> => {
      setPending(true);
      setError("");
      try {
        const value = await action();
        const text = done?.(value) ?? "";
        if (text !== "") setMessage(text);
        else setMessage("");
        return value;
      } catch (cause) {
        /*
         * 把原因显示出来，而且**优先用服务端那句**：它写了"该找谁""该先做什么"。
         * 拿不到 Error（极少数：抛了个字符串）时退化成一句兜底，绝不静默。
         */
        const reason =
          cause instanceof Error && cause.message.trim() !== ""
            ? cause.message
            : `操作没有成功（${String(cause)}）—— 请刷新这一页再试，仍然不行就看后端日志。`;
        setMessage("");
        setError(reason);
        return null;
      } finally {
        if (alive.current) setPending(false);
      }
    },
    [],
  );

  return { error, message, pending, clear, succeed, fail, run };
}
