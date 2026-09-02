import { useEffect, useState } from 'react';
import { useStore } from '../store/useStore';
import './PersonnelGate.css';

export function PersonnelGate() {
  const [employees, setEmployees] = useState<any[] | null>(null);
  const setActiveShift = useStore((s) => s.setActiveShift);
  const activeEmployeeId = useStore((s) => s.activeEmployeeId);

  useEffect(() => {
    window.api.employees.list().then(setEmployees);
  }, []);

  async function pick(employee: any) {
    const shiftId = await window.api.shifts.checkIn(employee.id);
    setActiveShift(shiftId, employee.id, employee.name);
  }

  // Nothing defined yet in Settings → skip the gate entirely, or already picked this session.
  if (employees === null || employees.length === 0 || activeEmployeeId != null) return null;

  return (
    <div className="gate-overlay">
      <div className="gate-panel">
        <div className="gate-title">شیفت خود را انتخاب کنید</div>
        <div className="gate-subtitle">با انتخاب نام خود، فروش‌ها و فعالیت‌ها به نام شما ثبت می‌شود</div>
        <div className="gate-grid">
          {employees.map((e) => (
            <button key={e.id} className="gate-person" onClick={() => pick(e)}>
              <span className="gate-person-avatar">{e.name.trim().charAt(0)}</span>
              <span className="gate-person-name">{e.name}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
