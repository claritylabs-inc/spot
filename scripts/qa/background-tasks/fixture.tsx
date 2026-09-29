import { StrictMode, useCallback, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  BackgroundTaskProvider,
  useBackgroundTasks,
} from "@claritylabs-inc/ui/components/background-tasks";
import { AppToaster } from "@claritylabs-inc/ui/components/app-shell/toaster";
import { usePolicyUpload } from "@/hooks/use-policy-upload";
import { ClientRequestDetail } from "@/components/procurement/client-requests-workspace";
import { PdfProvider } from "@/components/pdf-context";
import type { Id } from "@/convex/_generated/dataModel";
import Link, { usePathname, useRouter } from "./navigation";
import type { ReactNode } from "react";

const orgId = "org-1" as Id<"organizations">;
const registerUpload = async (args: unknown) => {
  const response = await fetch("/register", {
    method: "POST",
    body: JSON.stringify(args),
  });
  return response.json();
};
function PolicyUpload() {
  const router = useRouter();
  const [files, setFiles] = useState<File[]>([]);
  const [mode, setMode] = useState<"combined" | "separate">("combined");
  const { upload, uploading } = usePolicyUpload({
    orgId,
    registerUpload,
    onOpenPolicy: useCallback(
      (id: Id<"policies">) => router.push(`/policies/${id}`),
      [router],
    ),
  });
  const { tasks } = useBackgroundTasks();
  return (
    <section className="space-y-4">
      <h2>Policy upload</h2>
      <input
        type="file"
        multiple
        aria-label="Policy PDFs"
        onChange={(event) => setFiles(Array.from(event.target.files ?? []))}
      />
      <select
        aria-label="Upload mode"
        value={mode}
        onChange={(event) => setMode(event.target.value as typeof mode)}
      >
        <option value="combined">Combined</option>
        <option value="separate">Separate</option>
      </select>
      <button
        disabled={uploading || !files.length}
        onClick={() => void upload(files, mode)}
      >
        Upload policies
      </button>
      <button
        onClick={() => {
          void upload(files, mode);
          void upload(files, mode);
        }}
      >
        Submit twice
      </button>
      <p data-testid="upload-state">{uploading ? "Uploading" : "Idle"}</p>
      <p data-testid="progress">
        {JSON.stringify(tasks.get(`policy-upload:${orgId}`)?.progress)}
      </p>
    </section>
  );
}
const ignore = () => {};
function Fixture() {
  const path = usePathname();
  const [panel, setPanel] = useState<ReactNode>(null);
  return (
    <BackgroundTaskProvider>
      <PdfProvider>
        <main className="p-8 space-y-6">
          <h1>Spot upload workflow fixture</h1>
          <nav className="flex gap-6">
            <Link href="/">Policies</Link>
            <Link href="/requests/request-1">Request</Link>
            <Link href="/away">Another page</Link>
          </nav>
          <div className="flex gap-6">
            <div className="flex-1">
              {path === "/" ? (
                <PolicyUpload />
              ) : path === "/requests/request-1" ? (
                <ClientRequestDetail
                  requestId={"request-1" as Id<"procurementRequests">}
                  onBreadcrumb={ignore}
                  onRightPanel={setPanel}
                />
              ) : (
                <p>Another page: {path}</p>
              )}
            </div>
            {panel && <aside className="w-96 h-96">{panel}</aside>}
          </div>
        </main>
        <AppToaster />
      </PdfProvider>
    </BackgroundTaskProvider>
  );
}
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Fixture />
  </StrictMode>,
);
