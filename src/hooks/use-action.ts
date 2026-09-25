"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import type { ActionResult } from "@/lib/action-result";

/** Ejecuta server actions en una transición y muestra el error (o el éxito) con un toast. */
export function useAction() {
  const [pending, startTransition] = useTransition();

  function run<T>(
    action: () => Promise<ActionResult<T>>,
    options: { success?: string; onSuccess?: (data: T) => void } = {},
  ) {
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      if (options.success) toast.success(options.success);
      options.onSuccess?.(result.data);
    });
  }

  return { pending, run };
}
