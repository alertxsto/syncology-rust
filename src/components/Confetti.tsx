import { useEffect, useState } from "react";
import "./Confetti.css";

interface ConfettiProps {
  particleCount?: number;
}

interface Particle {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  rotation: number;
  color: string;
  shape: "circle" | "square" | "triangle";
}

const COLORS = ["#3b82f6", "#22c55e", "#f59e0b", "#ef4444", "#a855f7", "#93c5fd"];

export default function Confetti({ particleCount = 80 }: ConfettiProps) {
  const [particles, setParticles] = useState<Particle[]>([]);

  useEffect(() => {
    const newParticles: Particle[] = Array.from({ length: particleCount }, (_, i) => ({
      id: i,
      x: window.innerWidth / 2 + (Math.random() - 0.5) * 200,
      y: window.innerHeight / 2,
      vx: (Math.random() - 0.5) * 12,
      vy: -Math.random() * 10 - 4,
      rotation: Math.random() * 360,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      shape: ["circle", "square", "triangle"][Math.floor(Math.random() * 3)] as "circle" | "square" | "triangle",
    }));
    setParticles(newParticles);
  }, [particleCount]);

  return (
    <div className="confetti-overlay">
      {particles.map(p => (
        <div
          key={p.id}
          className={`confetti-particle ${p.shape}`}
          style={{
            left: `${p.x}px`,
            top: `${p.y}px`,
            background: p.shape === "triangle" ? "transparent" : p.color,
            borderBottomColor: p.shape === "triangle" ? p.color : "transparent",
            animationDelay: "0ms",
            ["--vx" as any]: `${p.vx}px`,
            ["--vy" as any]: `${p.vy}px`,
            ["--rot" as any]: `${p.rotation}deg`,
          }}
        />
      ))}
    </div>
  );
}
