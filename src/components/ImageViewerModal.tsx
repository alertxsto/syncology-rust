import { useState, useEffect } from "react";
import { openExternalUrl } from "@/lib/utils";
import "./Modal.css";

interface ImageViewerModalProps {
  imageUrls: string[];
  initialIndex?: number;
  onClose: () => void;
  title?: string;
}

export default function ImageViewerModal({
  imageUrls,
  initialIndex = 0,
  onClose,
  title = "Bukti Tangkapan Layar / Foto",
}: ImageViewerModalProps) {
  const [index, setIndex] = useState(initialIndex);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft") setIndex((prev) => (prev > 0 ? prev - 1 : imageUrls.length - 1));
      if (e.key === "ArrowRight") setIndex((prev) => (prev < imageUrls.length - 1 ? prev + 1 : 0));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, onClose, imageUrls.length]);

  if (!imageUrls || imageUrls.length === 0) return null;

  const currentUrl = imageUrls[index] || imageUrls[0];

  const handlePrev = () => {
    setIndex((prev) => (prev > 0 ? prev - 1 : imageUrls.length - 1));
  };

  const handleNext = () => {
    setIndex((prev) => (prev < imageUrls.length - 1 ? prev + 1 : 0));
  };

  return (
    <div
      className="modal-overlay"
      style={{
        zIndex: 9999,
        backgroundColor: "rgba(0, 0, 0, 0.88)",
        backdropFilter: "blur(8px)",
      }}
      onClick={onClose}
    >
      <div
        className="modal-content"
        style={{
          maxWidth: "90vw",
          maxHeight: "90vh",
          width: "auto",
          padding: "20px",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "16px",
          backgroundColor: "var(--bg-card)",
          border: "1px solid var(--border)",
          borderRadius: "12px",
          boxShadow: "0 20px 50px rgba(0,0,0,0.5)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            width: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            borderBottom: "1px solid var(--border)",
            paddingBottom: "12px",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column" }}>
            <span style={{ fontSize: "14px", fontWeight: 700, color: "var(--text-1)" }}>
              {title}
            </span>
            <span style={{ fontSize: "11px", color: "var(--text-3)" }}>
              Foto {index + 1} dari {imageUrls.length}
            </span>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <button
              className="btn-secondary"
              style={{ fontSize: "12px", padding: "4px 10px" }}
              onClick={() => openExternalUrl(currentUrl).catch(console.error)}
            >
              Buka Tautan ↗
            </button>
            <button
              className="modal-close-btn"
              onClick={onClose}
              style={{ fontSize: "18px", lineHeight: "1" }}
            >
              ✕
            </button>
          </div>
        </div>

        {/* Image Container */}
        <div
          style={{
            position: "relative",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            maxWidth: "80vw",
            maxHeight: "70vh",
            overflow: "hidden",
            borderRadius: "8px",
            backgroundColor: "#000",
          }}
        >
          <img
            src={currentUrl}
            alt="Evidence Detail"
            style={{
              maxWidth: "100%",
              maxHeight: "70vh",
              objectFit: "contain",
              display: "block",
            }}
          />

          {imageUrls.length > 1 && (
            <>
              <button
                style={{
                  position: "absolute",
                  left: "12px",
                  backgroundColor: "rgba(0,0,0,0.6)",
                  color: "#fff",
                  border: "1px solid var(--border)",
                  borderRadius: "50%",
                  width: "36px",
                  height: "36px",
                  cursor: "pointer",
                  fontSize: "18px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
                onClick={handlePrev}
              >
                ‹
              </button>

              <button
                style={{
                  position: "absolute",
                  right: "12px",
                  backgroundColor: "rgba(0,0,0,0.6)",
                  color: "#fff",
                  border: "1px solid var(--border)",
                  borderRadius: "50%",
                  width: "36px",
                  height: "36px",
                  cursor: "pointer",
                  fontSize: "18px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
                onClick={handleNext}
              >
                ›
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
