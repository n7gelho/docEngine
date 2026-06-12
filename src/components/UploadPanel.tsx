"use client";

import { useRef, useState } from "react";

type UploadPanelProps = {
  onUploaded: () => void;
};

type UploadSummary = {
  kind: "success" | "error";
  message: string;
};

function isAcceptedContractFile(file: File): boolean {
  const lower = file.name.toLowerCase();
  return lower.endsWith(".pdf") || lower.endsWith(".docx");
}

async function uploadSingleFile(file: File): Promise<Response> {
  const formData = new FormData();
  formData.append("file", file);
  return fetch("/api/documents", {
    method: "POST",
    body: formData,
  });
}

export function UploadPanel({ onUploaded }: UploadPanelProps) {
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [summary, setSummary] = useState<UploadSummary | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  async function uploadFiles(files: File[]) {
    const accepted = files.filter(isAcceptedContractFile);
    const skippedUnsupported = files.length - accepted.length;

    if (accepted.length === 0) {
      setSummary({
        kind: "error",
        message: "No PDF or DOCX files found to upload.",
      });
      return;
    }

    setUploading(true);
    setSummary(null);

    let acceptedCount = 0;
    let duplicateCount = 0;
    let failedCount = 0;

    for (let index = 0; index < accepted.length; index++) {
      const file = accepted[index];
      setProgress(`Uploading ${index + 1} of ${accepted.length}: ${file.name}`);

      try {
        const response = await uploadSingleFile(file);
        const data = await response.json();
        if (!response.ok) {
          failedCount += 1;
          continue;
        }
        if (data.duplicate) {
          duplicateCount += 1;
        } else {
          acceptedCount += 1;
        }
        onUploaded();
      } catch {
        failedCount += 1;
      }
    }

    const parts: string[] = [];
    if (acceptedCount > 0) parts.push(`${acceptedCount} uploaded`);
    if (duplicateCount > 0) parts.push(`${duplicateCount} duplicate`);
    if (skippedUnsupported > 0) {
      parts.push(`${skippedUnsupported} skipped (not PDF/DOCX)`);
    }
    if (failedCount > 0) parts.push(`${failedCount} failed`);

    setSummary({
      kind: failedCount > 0 && acceptedCount === 0 ? "error" : "success",
      message: parts.join(", ") + ". Processing started for new uploads.",
    });
    setProgress(null);
    setUploading(false);
    fileInputRef.current?.form?.reset();
    if (folderInputRef.current) folderInputRef.current.value = "";
  }

  async function handleSingleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const file = fileInputRef.current?.files?.[0];
    if (!file) return;
    await uploadFiles([file]);
  }

  async function handleFolderChange(event: React.ChangeEvent<HTMLInputElement>) {
    const files = event.target.files ? Array.from(event.target.files) : [];
    if (files.length === 0) return;
    await uploadFiles(files);
  }

  return (
    <div className="card">
      <h2 className="mb-4 text-lg font-semibold">Upload deal documents</h2>

      <form onSubmit={handleSingleSubmit} className="space-y-4">
        <div>
          <label className="label" htmlFor="file">
            Single file (PDF or DOCX)
          </label>
          <input
            ref={fileInputRef}
            id="file"
            name="file"
            type="file"
            accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            required
            disabled={uploading}
            className="input"
          />
        </div>
        <button type="submit" disabled={uploading} className="btn-primary">
          {uploading ? "Uploading…" : "Upload & ingest"}
        </button>
      </form>

      <div className="my-4 border-t border-border" />

      <div className="space-y-4">
        <div>
          <label className="label" htmlFor="folder">
            Folder of deal documents
          </label>
          <input
            ref={folderInputRef}
            id="folder"
            name="folder"
            type="file"
            accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            className="input"
            disabled={uploading}
            multiple
            onChange={handleFolderChange}
            {...({ webkitdirectory: "", directory: "" } as React.InputHTMLAttributes<HTMLInputElement>)}
          />
        </div>
        <p className="text-xs text-muted">
          Select a folder to upload all PDF and DOCX files inside (including
          subfolders). Other file types are ignored.
        </p>
      </div>

      {progress && <p className="mt-3 text-sm text-muted">{progress}</p>}
      {summary && (
        <p
          className={`mt-3 text-sm ${
            summary.kind === "error" ? "text-red-600" : "text-emerald-700"
          }`}
        >
          {summary.message}
        </p>
      )}

      <p className="mt-4 text-xs text-muted">
        Supports purchase and lease LOIs and OLAs. Metadata extraction uses the
        first few pages via Ollama (or OpenAI fallback).
      </p>
    </div>
  );
}
