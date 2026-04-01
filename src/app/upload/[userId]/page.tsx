"use client";
import { useParams } from "next/navigation";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { useState, useCallback } from "react";

type UploadState = "idle" | "uploading" | "processing" | "done" | "error";

export default function UploadPage() {
  const params = useParams();
  const token = params.userId as string;

  const user = useQuery(api.users.getByUploadToken, { token });
  const generateUploadUrl = useMutation(api.users.generateUploadUrl);
  const submitPolicy = useMutation(api.users.submitPolicy);

  const [state, setState] = useState<UploadState>("idle");
  const [dragOver, setDragOver] = useState(false);
  const [fileName, setFileName] = useState("");

  const handleFile = useCallback(
    async (file: File) => {
      if (!file.name.toLowerCase().endsWith(".pdf")) {
        alert("Please upload a PDF file.");
        return;
      }
      if (file.size > 20 * 1024 * 1024) {
        alert("File is too large. Max 20MB.");
        return;
      }

      setFileName(file.name);
      setState("uploading");

      try {
        const uploadUrl = await generateUploadUrl();
        const result = await fetch(uploadUrl, {
          method: "POST",
          headers: { "Content-Type": file.type },
          body: file,
        });

        if (!result.ok) throw new Error("Upload failed");

        const { storageId } = await result.json();

        setState("processing");
        await submitPolicy({ token, storageId });
        setState("done");
      } catch (err) {
        console.error(err);
        setState("error");
      }
    },
    [generateUploadUrl, submitPolicy, token]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  // Loading / invalid token
  if (user === undefined) {
    return (
      <div style={styles.page}>
        <div style={styles.container}>
          <div style={styles.spinner} />
        </div>
      </div>
    );
  }

  if (user === null) {
    return (
      <div style={styles.page}>
        <div style={styles.container}>
          <h1 style={styles.heading}>Invalid link</h1>
          <p style={styles.sub}>
            This upload link isn&apos;t valid. Text Spot to get a new one.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.page}>
      <div style={styles.container}>
        {/* Header */}
        <div style={{ marginBottom: "2.5rem", textAlign: "center" as const }}>
          <p
            style={{
              fontSize: "0.8rem",
              textTransform: "uppercase" as const,
              letterSpacing: "0.1em",
              color: "#8a8578",
              marginBottom: "0.5rem",
              fontWeight: 500,
            }}
          >
            Secure upload for {user.phone}
          </p>
          <h1 style={styles.heading}>Upload your policy</h1>
          <p style={styles.sub}>
            Drop your insurance policy PDF below. Spot will read through it and
            text you a breakdown.
          </p>
        </div>

        {/* Upload area */}
        {state === "idle" && (
          <label
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            style={{
              ...styles.dropzone,
              borderColor: dragOver ? "#111827" : "#e5e7eb",
              background: dragOver ? "#f5f3ef" : "#fff",
              cursor: "pointer",
            }}
          >
            <input
              type="file"
              accept=".pdf"
              onChange={handleInputChange}
              style={{ display: "none" }}
            />
            <div
              style={{
                fontSize: "2.5rem",
                marginBottom: "1rem",
                opacity: 0.3,
              }}
            >
              PDF
            </div>
            <p
              style={{
                fontSize: "0.95rem",
                color: "#111827",
                fontWeight: 500,
                marginBottom: "0.25rem",
              }}
            >
              Drop your PDF here
            </p>
            <p style={{ fontSize: "0.85rem", color: "#6b7280" }}>
              or tap to choose a file
            </p>
          </label>
        )}

        {state === "uploading" && (
          <div style={styles.statusCard}>
            <div style={styles.spinner} />
            <p style={styles.statusText}>Uploading {fileName}...</p>
          </div>
        )}

        {state === "processing" && (
          <div style={styles.statusCard}>
            <div style={styles.spinner} />
            <p style={styles.statusText}>
              Spot is reading your policy. You&apos;ll get a text with the
              breakdown shortly.
            </p>
          </div>
        )}

        {state === "done" && (
          <div style={styles.statusCard}>
            <div
              style={{
                width: 48,
                height: 48,
                borderRadius: "50%",
                background: "#111827",
                color: "#fff",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "1.5rem",
                marginBottom: "1rem",
              }}
            >
              ✓
            </div>
            <p style={styles.statusText}>
              All set! Check your texts — Spot will send you a breakdown
              shortly.
            </p>
            <button
              onClick={() => {
                setState("idle");
                setFileName("");
              }}
              style={styles.button}
            >
              Upload another policy
            </button>
          </div>
        )}

        {state === "error" && (
          <div style={styles.statusCard}>
            <p style={{ ...styles.statusText, color: "#dc2626" }}>
              Something went wrong. Try again.
            </p>
            <button
              onClick={() => {
                setState("idle");
                setFileName("");
              }}
              style={styles.button}
            >
              Try again
            </button>
          </div>
        )}

        {/* Footer */}
        <p
          style={{
            marginTop: "3rem",
            fontSize: "0.75rem",
            color: "#9ca3af",
            textAlign: "center" as const,
          }}
        >
          Your documents are encrypted and only used to help you understand your
          coverage.
        </p>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: "100vh",
    background: "#faf8f4",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    padding: "1.5rem",
  },
  container: {
    maxWidth: 440,
    width: "100%",
  },
  heading: {
    fontFamily: "'Instrument Serif', serif",
    fontSize: "2rem",
    fontWeight: 400,
    color: "#000",
    letterSpacing: "-0.03em",
    lineHeight: 1.2,
    marginBottom: "0.75rem",
    textAlign: "center" as const,
  },
  sub: {
    fontSize: "0.95rem",
    color: "#6b7280",
    lineHeight: 1.6,
    textAlign: "center" as const,
    marginBottom: 0,
  },
  dropzone: {
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "center",
    justifyContent: "center",
    border: "2px dashed #e5e7eb",
    borderRadius: 16,
    padding: "3rem 2rem",
    textAlign: "center" as const,
    transition: "all 0.2s ease",
  },
  statusCard: {
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "center",
    justifyContent: "center",
    background: "#fff",
    border: "1px solid #e5e7eb",
    borderRadius: 16,
    padding: "3rem 2rem",
    textAlign: "center" as const,
  },
  statusText: {
    fontSize: "0.95rem",
    color: "#111827",
    lineHeight: 1.6,
  },
  spinner: {
    width: 32,
    height: 32,
    border: "3px solid #e5e7eb",
    borderTopColor: "#111827",
    borderRadius: "50%",
    animation: "spin 0.8s linear infinite",
    marginBottom: "1rem",
  },
  button: {
    marginTop: "1.5rem",
    padding: "0.6rem 1.5rem",
    background: "#111827",
    color: "#fff",
    border: "none",
    borderRadius: 999,
    fontSize: "0.85rem",
    fontWeight: 500,
    cursor: "pointer",
    fontFamily: "inherit",
  },
};
