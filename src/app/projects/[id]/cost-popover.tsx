"use client";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { OPERATION_LABEL, formatDuration, formatUsd, type CostLine } from "@/lib/projects/data";

/** Costo acumulado del proyecto con el desglose por operación, motor y modelo. */
export function CostPopover({ total, lines }: { total: number; lines: CostLine[] }) {
  const calls = lines.reduce((s, l) => s + l.calls, 0);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className="rounded-md px-2 py-1 text-right hover:bg-muted">
          <div className="text-xs text-muted-foreground">Costo del proyecto</div>
          <div className="font-medium tabular-nums">{formatUsd(total)}</div>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[34rem] p-0">
        <div className="border-b px-3 py-2 text-sm font-medium">
          {formatUsd(total)} <span className="font-normal text-muted-foreground">· {calls} llamadas a motores</span>
        </div>
        {lines.length === 0 ? (
          <p className="p-3 text-xs text-muted-foreground">Todavía no hubo llamadas a motores.</p>
        ) : (
          <table className="w-full text-xs">
            <thead className="text-left text-muted-foreground">
              <tr className="border-b">
                <th className="px-3 py-1.5 font-medium">Operación</th>
                <th className="px-2 py-1.5 font-medium">Modelo</th>
                <th className="px-2 py-1.5 text-right font-medium">Llamadas</th>
                <th className="px-2 py-1.5 text-right font-medium">Tiempo</th>
                <th className="px-3 py-1.5 text-right font-medium">Costo</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={`${l.operation}-${l.engine}-${l.model}`} className="border-b last:border-0">
                  <td className="px-3 py-1.5">
                    {OPERATION_LABEL[l.operation] ?? l.operation}
                    {l.images > 0 && <span className="text-muted-foreground"> · {l.images} img</span>}
                  </td>
                  <td className="px-2 py-1.5 text-muted-foreground">
                    {l.engine} · {l.model}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">
                    {l.calls}
                    {l.errors > 0 && <span className="text-destructive"> ({l.errors} con error)</span>}
                  </td>
                  <td className="px-2 py-1.5 text-right text-muted-foreground tabular-nums">
                    {formatDuration(Math.round(l.durationMs / 1000))}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{formatUsd(l.costUsd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="border-t px-3 py-2 text-[11px] text-muted-foreground">
          Costos estimados con los precios públicos de cada proveedor al registrar la llamada.
        </p>
      </PopoverContent>
    </Popover>
  );
}
