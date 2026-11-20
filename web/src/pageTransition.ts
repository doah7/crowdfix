import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigationType } from "react-router-dom";

/** 화면 전환 효과 길이(ms). styles.css의 page-* 애니메이션과 맞춘다. */
export const PAGE_TRANSITION_MS = 240;

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

/**
 * 화면 들어올 때·나갈 때 효과.
 * - 들어올 때: 새로 연 경우에만 (뒤로가기로 돌아온 경우는 효과 없이)
 * - 나갈 때: leave(fn)으로 효과를 보여준 뒤 fn(이동)을 실행
 */
export function usePageTransition(leaveMs: number = PAGE_TRANSITION_MS) {
  const navType = useNavigationType();
  const [entering] = useState(() => navType !== "POP" && !prefersReducedMotion());
  const [leaving, setLeaving] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => () => clearTimeout(timer.current), []);

  const leave = useCallback((go: () => void) => {
    if (prefersReducedMotion()) return go();
    setLeaving(true);
    timer.current = setTimeout(go, leaveMs);
  }, [leaveMs]);

  const phase = leaving ? "leave" : entering ? "enter" : "";
  return { phase, leave };
}
