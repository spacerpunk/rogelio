"use client";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

export default function AppError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <div className="p-6">
      <Alert variant="destructive" className="max-w-xl">
        <AlertTitle>Algo salió mal</AlertTitle>
        <AlertDescription>{error.message}</AlertDescription>
      </Alert>
      <Button variant="outline" size="sm" className="mt-3" onClick={() => retry()}>
        Reintentar
      </Button>
    </div>
  );
}
