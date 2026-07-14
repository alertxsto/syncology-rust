import { useEffect, useMemo, useState } from "react";
import { cx, normalizeExternalUrl } from "@/lib/utils";
import type { EvidenceType, TypedEvidenceMeta } from "@/types";
import "./Modal.css";

interface SubmitEvidenceModalProps {
  taskTitle?: string;
  onCancel: () => void;
  onConfirm: (payload: { evidenceUrl: string; evidenceMeta: TypedEvidenceMeta }) => void;
}

export default function SubmitEvidenceModal({ taskTitle, onCancel, onConfirm }: SubmitEvidenceModalProps) {
  const [evidenceType, setEvidenceType] = useState<EvidenceType>("github_pr");
  const [primaryUrl, setPrimaryUrl] = useState("");
  const [githubPrNum, setGithubPrNum] = useState("");
  const [githubCommitHash, setGithubCommitHash] = useState("");
  const [imageInput, setImageInput] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  // Clean and parse image inputs (for uploader)
  const imageUrls = useMemo(
    () => imageInput
      .split(/\n|,/) 
      .map(s => normalizeExternalUrl(s.trim()))
      .filter(Boolean),
    [imageInput]
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanUrl = normalizeExternalUrl(primaryUrl.trim());

    if (evidenceType !== "image" && !cleanUrl) {
      setError("Masukkan URL bukti utama.");
      return;
    }

    if (evidenceType === "image" && imageUrls.length === 0) {
      setError("Masukkan minimal satu URL gambar.");
      return;
    }

    // Validation formats
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
          
          {/* Dropdown Tipe Bukti */}
          <div className="form-field">
            <label className="form-label">Tipe Bukti Pengerjaan</label>
            <select
              className="form-input"
              value={evidenceType}
              onChange={(e) => {
                setEvidenceType(e.target.value as EvidenceType);
                setPrimaryUrl("");
                setError("");
              }}
              style={{ padding: "6px 10px", height: "38px" }}
            >
              <option value="github_pr">🐙 GitHub Pull Request</option>
              <option value="github_commit">💻 GitHub Commit</option>
              <option value="document">📄 Dokumen (Notion/Google Docs)</option>
              <option value="image">🖼️ Screenshot / Gambar Bukti</option>
              <option value="other_url">🔗 Link Web / URL Lainnya</option>
            </select>
          </div>

          {/* Form Dinamis: GitHub PR */}
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

          {/* Form Dinamis: GitHub Commit */}
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

          {/* Form Dinamis: Document */}
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

          {/* Form Dinamis: Image */}
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

          {/* Form Dinamis: Other URL */}
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

          {/* Notes (Common to all) */}
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
            <button type="submit" className={cx("btn-primary")}>Submit Bukti</button>
          </div>
        </form>
      </div>
    </div>
  );
}
