import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { cx, normalizeExternalUrl } from "@/lib/utils";
import type { EvidenceType, TypedEvidenceMeta } from "@/types";
import "./Modal.css";

interface SubmitEvidenceModalProps {
  taskTitle?: string;
  onCancel: () => void;
  onConfirm: (payload: { evidenceUrl: string; evidenceMeta: TypedEvidenceMeta }) => void;
  taskId?: string;
}

export default function SubmitEvidenceModal({ taskTitle, onCancel, onConfirm, taskId }: SubmitEvidenceModalProps) {
  const [evidenceType, setEvidenceType] = useState<EvidenceType>("github_pr");
  const [primaryUrl, setPrimaryUrl] = useState("");
  const [githubPrNum, setGithubPrNum] = useState("");
  const [githubCommitHash, setGithubCommitHash] = useState("");
  const [imageInput, setImageInput] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");

  const [uploadingFile, setUploadingFile] = useState(false);
  const [selectedFileName, setSelectedFileName] = useState("");
  const [selectedFileSize, setSelectedFileSize] = useState(0);
  const [uploadedFileMeta, setUploadedFileMeta] = useState<{ url: string; file_name: string; file_type: string; file_size: number } | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const handlePickFile = async () => {
    try {
      const selected = await open({
        multiple: false,
        filters: [
          {
            name: "All Supported",
            extensions: ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt", "zip"],
          },
        ],
      });
      if (!selected) return;

      const filePath = selected as string;
      const name = filePath.split(/[\\/]/).pop() || "unknown";

      setUploadingFile(true);
      setSelectedFileName(name);
      setError("");

      const result = await invoke<{ url: string; file_name: string; file_type: string; file_size: number }>("upload_evidence_file", {
        filePath,
        taskId: taskId || "pending",
      });

      setUploadedFileMeta(result);
      setSelectedFileSize(result.file_size);
      setUploadingFile(false);
    } catch (e) {
      setError(String(e));
      setUploadingFile(false);
      setSelectedFileName("");
    }
  };

  const imageUrls = useMemo(
    () => imageInput
      .split(/\n|,/) 
      .map(s => normalizeExternalUrl(s.trim()))
      .filter(Boolean),
    [imageInput]
  );

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const isImage = (mime: string) => mime.startsWith("image/");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (evidenceType === "file_upload") {
      if (!uploadedFileMeta) {
        setError("Pilih dan upload file terlebih dahulu.");
        return;
      }
      const evidenceMeta: TypedEvidenceMeta = {
        type: "file_upload",
        primary_url: uploadedFileMeta.url,
        notes: notes.trim() || undefined,
        file_name: uploadedFileMeta.file_name,
        file_type: uploadedFileMeta.file_type,
        file_size: uploadedFileMeta.file_size,
      };
      onConfirm({ evidenceUrl: uploadedFileMeta.url, evidenceMeta });
      return;
    }

    const cleanUrl = normalizeExternalUrl(primaryUrl.trim());

    if (evidenceType !== "image" && !cleanUrl) {
      setError("Masukkan URL bukti utama.");
      return;
    }

    if (evidenceType === "image" && imageUrls.length === 0) {
      setError("Masukkan minimal satu URL gambar.");
      return;
    }

    if (evidenceType === "github_pr" && !cleanUrl.includes("github.com")) {
      setError("URL harus berupa link GitHub Pull Request valid.");
      return;
    }

    if (evidenceType === "github_commit" && !cleanUrl.includes("github.com")) {
      setError("URL harus berupa link GitHub Commit valid.");
      return;
    }

    const finalPrimaryUrl = evidenceType === "image" ? imageUrls[0] : cleanUrl;

    const evidenceMeta: TypedEvidenceMeta = {
      type: evidenceType,
      primary_url: finalPrimaryUrl,
      notes: notes.trim() || undefined,
      github_pr_num: (evidenceType === "github_pr" && githubPrNum.trim()) ? githubPrNum.trim() : undefined,
      github_commit_hash: (evidenceType === "github_commit" && githubCommitHash.trim()) ? githubCommitHash.trim() : undefined,
      image_urls: evidenceType === "image" ? imageUrls : undefined,
    };

    onConfirm({
      evidenceUrl: finalPrimaryUrl,
      evidenceMeta,
    });
  };

  return (
    <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="modal-box fade-in" style={{ maxWidth: 620 }}>
        <div className="modal-header">
          <span className="modal-title">Submit Bukti{taskTitle ? ` · ${taskTitle}` : ""}</span>
          <button className="modal-close" onClick={onCancel}>✕</button>
        </div>

        <form className="modal-body" onSubmit={handleSubmit}>
          
          <div className="form-field">
            <label className="form-label">Tipe Bukti Pengerjaan</label>
            <select
              className="form-input"
              value={evidenceType}
              onChange={(e) => {
                setEvidenceType(e.target.value as EvidenceType);
                setPrimaryUrl("");
                setError("");
                setUploadedFileMeta(null);
                setSelectedFileName("");
              }}
              style={{ padding: "6px 10px", height: "38px" }}
            >
              <option value="github_pr">🐙 GitHub Pull Request</option>
              <option value="github_commit">💻 GitHub Commit</option>
              <option value="document">📄 Dokumen (Notion/Google Docs)</option>
              <option value="image">🖼️ Screenshot / Gambar Bukti</option>
              <option value="file_upload">📎 Upload File (Gambar/PDF/DOCX)</option>
              <option value="other_url">🔗 Link Web / URL Lainnya</option>
            </select>
          </div>

          {/* File Upload */}
          {evidenceType === "file_upload" && (
            <div className="form-field">
              <label className="form-label">Upload File Bukti</label>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={handlePickFile}
                  disabled={uploadingFile}
                  style={{ whiteSpace: "nowrap" }}
                >
                  {uploadingFile ? "⏳ Uploading..." : "📁 Pilih File"}
                </button>
                {selectedFileName && (
                  <span style={{ fontSize: 12, color: "var(--text-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {selectedFileName} {selectedFileSize > 0 && `(${formatSize(selectedFileSize)})`}
                  </span>
                )}
              </div>
              {uploadedFileMeta && (
                <div style={{ marginTop: 10, padding: 10, background: "var(--bg-elevated)", borderRadius: 8, border: "1px solid var(--border)" }}>
                  {isImage(uploadedFileMeta.file_type) ? (
                    <img
                      src={uploadedFileMeta.url}
                      alt={uploadedFileMeta.file_name}
                      style={{ maxWidth: "100%", maxHeight: 200, borderRadius: 4, display: "block" }}
                    />
                  ) : (
                    <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                      <span style={{ fontSize: 24 }}>📄</span>
                      <div>
                        <div style={{ fontWeight: 600 }}>{uploadedFileMeta.file_name}</div>
                        <div style={{ color: "var(--text-2)" }}>{formatSize(uploadedFileMeta.file_size)} · {uploadedFileMeta.file_type}</div>
                      </div>
                    </div>
                  )}
                  <a
                    href={uploadedFileMeta.url}
                    target="_blank"
                    rel="noreferrer"
                    style={{ display: "inline-block", marginTop: 8, fontSize: 12, color: "var(--accent)" }}
                  >
                    🔗 Buka di tab baru
                  </a>
                </div>
              )}
              <div style={{ marginTop: 6, fontSize: 11, color: "var(--text-3)" }}>
                Format: PNG, JPG, GIF, WebP, PDF, DOCX, XLSX, PPTX, TXT, ZIP. Maks 10 MB.
              </div>
            </div>
          )}

          {/* GitHub PR */}
          {evidenceType === "github_pr" && (
            <>
              <div className="form-field">
                <label className="form-label">Link Pull Request GitHub</label>
                <input
                  className="form-input"
                  type="url"
                  placeholder="https://github.com/org/repo/pull/123"
                  value={primaryUrl}
                  onChange={(e) => { setPrimaryUrl(e.target.value); setError(""); }}
                  required
                />
              </div>
              <div className="form-field">
                <label className="form-label">Nomor PR (opsional)</label>
                <input
                  className="form-input"
                  type="number"
                  placeholder="Contoh: 123"
                  value={githubPrNum}
                  onChange={(e) => setGithubPrNum(e.target.value)}
                />
              </div>
            </>
          )}

          {/* GitHub Commit */}
          {evidenceType === "github_commit" && (
            <>
              <div className="form-field">
                <label className="form-label">Link Commit GitHub</label>
                <input
                  className="form-input"
                  type="url"
                  placeholder="https://github.com/org/repo/commit/7c968f..."
                  value={primaryUrl}
                  onChange={(e) => { setPrimaryUrl(e.target.value); setError(""); }}
                  required
                />
              </div>
              <div className="form-field">
                <label className="form-label">SHA Hash Commit (opsional)</label>
                <input
                  className="form-input"
                  type="text"
                  placeholder="Contoh: 7c968f0"
                  value={githubCommitHash}
                  onChange={(e) => setGithubCommitHash(e.target.value)}
                />
              </div>
            </>
          )}

          {/* Document */}
          {evidenceType === "document" && (
            <div className="form-field">
              <label className="form-label">Link Dokumen (Google Docs/Notion/Sheets)</label>
              <input
                className="form-input"
                type="url"
                placeholder="https://notion.so/... atau https://docs.google.com/..."
                value={primaryUrl}
                onChange={(e) => { setPrimaryUrl(e.target.value); setError(""); }}
                required
              />
            </div>
          )}

          {/* Image URLs */}
          {evidenceType === "image" && (
            <div className="form-field">
              <label className="form-label">Link Gambar Bukti (URL, pisahkan dengan enter atau koma)</label>
              <textarea
                className="form-input form-textarea"
                rows={3}
                placeholder="https://.../screenshot-1.png&#10;https://.../screenshot-2.jpg"
                value={imageInput}
                onChange={(e) => { setImageInput(e.target.value); setError(""); }}
              />
              {imageUrls.length > 0 && (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: 8, marginTop: "8px" }}>
                  {imageUrls.slice(0, 6).map((u) => (
                    <a key={u} href={u} target="_blank" rel="noreferrer" style={{ border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden", display: "block", background: "var(--bg-elevated)" }}>
                      <img src={u} alt="Preview" style={{ width: "100%", height: 84, objectFit: "cover", display: "block" }} />
                    </a>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Other URL */}
          {evidenceType === "other_url" && (
            <div className="form-field">
              <label className="form-label">Link / URL Bukti Utama</label>
              <input
                className="form-input"
                type="url"
                placeholder="https://example.com/..."
                value={primaryUrl}
                onChange={(e) => { setPrimaryUrl(e.target.value); setError(""); }}
                required
              />
            </div>
          )}

          {/* Notes */}
          <div className="form-field">
            <label className="form-label">Catatan Tambahan (opsional)</label>
            <textarea
              className="form-input form-textarea"
              rows={2}
              placeholder="Deskripsikan pekerjaan kamu..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>

          {error && <div className="form-error">{error}</div>}

          <div className="modal-footer">
            <button type="button" className="btn-secondary" onClick={onCancel}>Batal</button>
            <button type="submit" className={cx("btn-primary")} disabled={uploadingFile}>Submit Bukti</button>
          </div>
        </form>
      </div>
    </div>
  );
}