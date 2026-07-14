import { useState, useMemo } from "react";
import type { Task } from "@/types";
import { cx } from "@/lib/utils";
import "./CalendarView.css";

interface CalendarViewProps {
  tasks: Task[];
  onSelectTask: (task: Task) => void;
}

const WEEKDAYS = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];
const MONTHS = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember"
];

export default function CalendarView({ tasks, onSelectTask }: CalendarViewProps) {
  const today = new Date();
  const [currentMonth, setCurrentMonth] = useState(today.getMonth());
  const [currentYear, setCurrentYear]   = useState(today.getFullYear());

  // Build calendar grid
  const firstDayOfMonth = new Date(currentYear, currentMonth, 1);
  const lastDayOfMonth  = new Date(currentYear, currentMonth + 1, 0);
  const startWeekday    = firstDayOfMonth.getDay(); // 0 = Sunday
  const daysInMonth     = lastDayOfMonth.getDate();

  // Tasks indexed by date string YYYY-MM-DD
  const tasksByDate = useMemo(() => {
    const map: Record<string, Task[]> = {};
    tasks.forEach(t => {
      const dl = t.internal_deadline;
      if (!dl) return;
      const dayKey = dl.substring(0, 10);
      if (!map[dayKey]) map[dayKey] = [];
      map[dayKey].push(t);
    });
    return map;
  }, [tasks]);

  // Build grid (6 weeks = 42 cells)
  const cells: ({ date: Date; day: number; isCurrentMonth: boolean } | null)[] = [];
  // Leading empty cells for previous month
  for (let i = 0; i < startWeekday; i++) {
    const day = new Date(currentYear, currentMonth, -startWeekday + i + 1);
    cells.push({ date: day, day: day.getDate(), isCurrentMonth: false });
  }
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ date: new Date(currentYear, currentMonth, d), day: d, isCurrentMonth: true });
  }
  // Trailing cells to fill 42
  while (cells.length < 42) {
    const last = cells[cells.length - 1]!;
    const next = new Date(last.date);
    next.setDate(next.getDate() + 1);
    cells.push({ date: next, day: next.getDate(), isCurrentMonth: false });
  }

  const goPrev = () => {
    if (currentMonth === 0) {
      setCurrentMonth(11);
      setCurrentYear(y => y - 1);
    } else {
      setCurrentMonth(m => m - 1);
    }
  };
  const goNext = () => {
    if (currentMonth === 11) {
      setCurrentMonth(0);
      setCurrentYear(y => y + 1);
    } else {
      setCurrentMonth(m => m + 1);
    }
  };
  const goToday = () => {
    setCurrentMonth(today.getMonth());
    setCurrentYear(today.getFullYear());
  };

  const todayKey = today.toISOString().substring(0, 10);

  return (
    <div className="calendar-container fade-in">
      <div className="calendar-header">
        <div className="calendar-month">
          <button className="cal-nav-btn" onClick={goPrev} aria-label="Previous month">‹</button>
          <span className="cal-month-label">{MONTHS[currentMonth]} {currentYear}</span>
          <button className="cal-nav-btn" onClick={goNext} aria-label="Next month">›</button>
        </div>
        <button className="btn-secondary cal-today-btn" onClick={goToday}>Hari Ini</button>
      </div>

      <div className="calendar-grid">
        {WEEKDAYS.map(d => (
          <div key={d} className="calendar-weekday">{d}</div>
        ))}
        {cells.map((cell, i) => {
          if (!cell) return <div key={i} className="calendar-cell empty" />;
          const dateKey = cell.date.toISOString().substring(0, 10);
          const dayTasks = tasksByDate[dateKey] || [];
          const isToday = dateKey === todayKey;

          return (
            <div
              key={i}
              className={cx(
                "calendar-cell",
                !cell.isCurrentMonth && "outside-month",
                isToday && "is-today"
              )}
            >
              <div className="cell-day">{cell.day}</div>
              <div className="cell-tasks">
                {dayTasks.slice(0, 3).map(t => {
                  const isOverdue = !isToday && dateKey < todayKey && t.status !== "completed";
                  const isDone = t.status === "completed";
                  const isGhost = t.escalation_level === 3;
                  return (
                    <button
                      key={t.id}
                      className={cx(
                        "cell-task",
                        isOverdue && "overdue",
                        isDone && "done",
                        isGhost && "ghost"
                      )}
                      onClick={() => onSelectTask(t)}
                      title={t.title}
                    >
                      <span className="cell-task-dot" />
                      <span className="cell-task-title">{t.title}</span>
                    </button>
                  );
                })}
                {dayTasks.length > 3 && (
                  <div className="cell-more">+{dayTasks.length - 3} lainnya</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
