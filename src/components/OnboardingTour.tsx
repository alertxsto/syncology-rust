import { useState, useEffect } from "react";
import { 
  FiTarget, 
  FiHome, 
  FiCheckSquare, 
  FiPaperclip, 
  FiZap, 
  FiMessageSquare, 
  FiCommand, 
  FiAward 
} from "react-icons/fi";
import "./OnboardingTour.css";

interface OnboardingTourProps {
  onClose: () => void;
}

const STEPS = [
  {
    title: "Selamat datang di Syncology!",
    body: "Aplikasi manajemen tugas tim berbasis akuntabilitas poin. Mari kita tur singkat 30 detik.",
    icon: <FiTarget />,
    highlight: null,
  },
  {
    title: "Buat atau Gabung Room",
    body: "Di tab 'My Rooms', kamu bisa buat room baru (auto-leader) atau gabung dengan kode 6 karakter dari leader tim.",
    icon: <FiHome />,
    highlight: "tab-home",
  },
  {
    title: "Propose & Assign Task",
    body: "Di tab Tasks, klik '+ Propose Task' untuk mengusulkan tugas baru. Pilih difficulty (Easy 5pt → Very Hard 35pt). Leader approve dulu sebelum jadi Todo.",
    icon: <FiCheckSquare />,
    highlight: "tab-tasks",
  },
  {
    title: "Submit Bukti & Review",
    body: "Assignee submit URL bukti → system pilih reviewer acak → reviewer approve/reject. Approved = poin masuk!",
    icon: <FiPaperclip />,
    highlight: null,
  },
  {
    title: "Ghost Pool & Rescue",
    body: "Task yang telat atau call-for-backup akan masuk Ghost Pool (escalation level 3). Siapapun bisa rescue dengan bonus +50% poin.",
    icon: <FiZap />,
    highlight: null,
  },
  {
    title: "Nudge & Chat",
    body: "Mentok? Nudge rekan setmu (max 3/hari, +2 poin buat kamu). Diskusi cepat lewat chat room — gunakan #task-id untuk link ke task.",
    icon: <FiMessageSquare />,
    highlight: null,
  },
  {
    title: "Command Palette (⌘K)",
    body: "Tekan Cmd/Ctrl+K untuk search room, navigasi cepat, atau toggle theme. Power user必备!",
    icon: <FiCommand />,
    highlight: null,
  },
  {
    title: "Selamat berkolaborasi!",
    body: "Itu saja dasarnya. Kamu bisa ulangi tour ini kapan saja lewat Command Palette → 'Help'.",
    icon: <FiAward />,
    highlight: null,
  },
];

export default function OnboardingTour({ onClose }: OnboardingTourProps) {
  const [stepIdx, setStepIdx] = useState(0);
  const step = STEPS[stepIdx];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight" || e.key === "Enter") {
        if (stepIdx < STEPS.length - 1) setStepIdx(i => i + 1);
        else onClose();
      }
      if (e.key === "ArrowLeft") {
        if (stepIdx > 0) setStepIdx(i => i - 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [stepIdx, onClose]);

  const next = () => {
    if (stepIdx < STEPS.length - 1) setStepIdx(i => i + 1);
    else onClose();
  };
  const prev = () => {
    if (stepIdx > 0) setStepIdx(i => i - 1);
  };
  const skip = () => onClose();

  return (
    <div className="onboarding-overlay" onClick={e => { if (e.target === e.currentTarget) skip(); }}>
      <div className="onboarding-card fade-in">
        <div className="onboarding-icon">{step.icon}</div>
        <h2 className="onboarding-title">{step.title}</h2>
        <p className="onboarding-body">{step.body}</p>

        <div className="onboarding-progress">
          {STEPS.map((_, i) => (
            <div
              key={i}
              className={`onboarding-dot ${i === stepIdx ? "active" : ""} ${i < stepIdx ? "done" : ""}`}
            />
          ))}
        </div>

        <div className="onboarding-actions">
          <button className="btn-secondary onboarding-skip" onClick={skip}>Lewati</button>
          <div className="onboarding-nav">
            {stepIdx > 0 && (
              <button className="btn-secondary" onClick={prev}>‹ Prev</button>
            )}
            <button className="btn-primary" onClick={next}>
              {stepIdx === STEPS.length - 1 ? "Mulai" : "Lanjut ›"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
