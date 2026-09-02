import { create } from 'zustand';

export interface Toast {
  id: number;
  title: string;
  body: string;
  level: 'info' | 'warning' | 'danger';
}

interface AppState {
  toasts: Toast[];
  pushToast: (t: Omit<Toast, 'id'>) => void;
  dismissToast: (id: number) => void;

  activeShiftId: number | null;
  activeEmployeeId: number | null;
  activeEmployeeName: string | null;
  setActiveShift: (shiftId: number | null, employeeId: number | null, name: string | null) => void;
}

let toastSeq = 1;

export const useStore = create<AppState>((set) => ({
  toasts: [],
  pushToast: (t) =>
    set((s) => ({ toasts: [...s.toasts, { ...t, id: toastSeq++ }] })),
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  activeShiftId: null,
  activeEmployeeId: null,
  activeEmployeeName: null,
  setActiveShift: (shiftId, employeeId, name) =>
    set({ activeShiftId: shiftId, activeEmployeeId: employeeId, activeEmployeeName: name }),
}));
