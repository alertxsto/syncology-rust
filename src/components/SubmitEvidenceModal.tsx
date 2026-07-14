import { useEffect, useMemo, useState } from "react";
import { cx, normalizeExternalUrl } from "@/lib/utils";
import "./Modal.css";

interface SubmitEvidencePayload {
  evidenceUrl: string;
  githubUrl: string;
  imageUrls: string[];
  notes: string;
}

interface SubmitEvidenceModalProps {
  taskTitle?: string;
  onCancel: () => void;
  onConfirm: (payload: SubmitEvidencePayload) => void;
}

function detectGithubKind(url: string): "pr" | "issue" | "commit" | "repo" | null {
  const u = url.toLowerCase();
  if (!u.includes("github.com")) return null;
  if (/\/pull\//.test(u)) return "pr";
  if (/\/issues\//.test(u)) return "issue";
  if (/\/commit\//.test(u)) return "commit";
  return "repo";
}

export default function SubmitEvidenceModal({ taskTitle, onCancel, onConfirm }: SubmitEvidenceModalProps) {
  const [evidenceUrl, setEvidenceUrl] = useState("");
  const [githubUrl, setGithubUrl] = useState("");
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

  const imageUrls = useMemo(
    () => imageInput
      .split(/\n|,/) 
      .map(s => normalizeExternalUrl(s.trim()))
      .filter(Boolean),
    [imageInput]
  );

  const githubKind = detectGithubKind(githubUrl);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const main = normalizeExternalUrl(evidenceUrl.trim());
    const gh = normalizeExternalUrl(githubUrl.trim());

    if (!main && !gh && imageUrls.length === 0) {
      setError("Isi minimal salah satu: Link Bukti, Link GitHub, atau Gambar.");
      return;
    }

    onConfirm({
      evidenceUrl: main || gh || imageUrls[0] || "",
      githubUrl: gh,
      imageUrls,
      notes: notes.trim(),
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
            <label className="form-label">Link bukti utama</label>
            <input
              className="form-input"
              type="url"
              placeholder="https://..."
              value={evidenceUrl}
              onChange={(e) => { setEvidenceUrl(e.target.value); setError(""); }}
            />
          </div>

          <div className="form-field">
            <label className="form-label">Integrasi GitHub (PR / Commit / Issue / Repo)</label>
            <input
              className="form-input"
              type="url"
              placeholder="https://github.com/org/repo/pull/123"
              value={githubUrl}
              onChange={(e) => { setGithubUrl(e.target.value); setError(""); }}
            />
            {githubUrl.trim() && (
              <span style={{ fontSize: 12, color: "var(--text-3)" }}>
                {githubKind ? `Terdeteksi: GitHub ${githubKind.toUpperCase()}` : "URL bukan GitHub (tetap boleh)."}
              </span>
            )}
          </div>

          <div className="form-field">
            <label className="form-label">Gambar bukti (URL, pisahkan dengan enter atau koma)</label>
            <textarea
              className="form-input form-textarea"
              rows={3}
              placeholder="https://.../screenshot-1.png\nhttps://.../screenshot-2.jpg"
              value={imageInput}
              onChange={(e) => { setImageInput(e.target.value); setError(""); }}
            />
            {imageUrls.length > 0 && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: 8 }}>
                {imageUrls.slice(0, 6).map((u) => (
                  <a key={u} href={u} target="_blank" rel="noreferrer" style={{ border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden", display: "block", background: "var(--bg-elevated)" }}>
                    <img src={u} alt="Evidence" style={{ width: "100%", height: 84, objectFit: "cover", display: "block" }} />
                  </a>
                ))}
              </div>
            )}
          </div>

          <div className="form-field">
            <label className="form-label">Catatan (opsional)</label>
            <textarea
              className="form-input form-textarea"
              rows={2}
              placeholder="Ringkasan perubahan / konteks bukti..."
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
