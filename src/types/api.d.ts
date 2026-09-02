export {};

declare global {
  interface Window {
    api: {
      onEvent: (cb: (e: { domains: string[]; payload?: any }) => void) => () => void;
      recovery: { getOrphans: () => Promise<any[]> };
      settings: {
        getAll: () => Promise<Record<string, string>>;
        set: (key: string, value: string) => Promise<void>;
      };
      unitTypes: {
        list: () => Promise<any[]>;
        create: (data: any) => Promise<number>;
        update: (id: number, data: any) => Promise<void>;
        archive: (id: number) => Promise<void>;
      };
      units: {
        list: () => Promise<any[]>;
        create: (data: any) => Promise<number>;
        update: (id: number, data: any) => Promise<void>;
        archive: (id: number) => Promise<void>;
        start: (unitId: number, customerId?: number, activeTiers?: number, tabId?: number) => Promise<void>;
        reserve: (unitId: number) => Promise<void>;
        cancelReserve: (unitId: number) => Promise<void>;
        calcAmount: (unitId: number) => Promise<{ exactMinutes: number; exactAmount: number; roundedAmount: number }>;
        endToTab: (unitId: number, tabId?: number) => Promise<{ sessionId: number; tabId: number; durationMinutes: number; exactAmount: number; amount: number }>;
        linkToTab: (unitId: number, tabId: number) => Promise<void>;
      };
      cafeItems: {
        list: () => Promise<any[]>;
        create: (data: any) => Promise<number>;
        update: (id: number, data: any) => Promise<void>;
        archive: (id: number) => Promise<void>;
        restock: (id: number, qty: number) => Promise<void>;
      };
      cafeCategories: {
        list: () => Promise<any[]>;
        create: (name: string, emoji: string) => Promise<number>;
        update: (id: number, data: { name?: string; emoji?: string }) => Promise<void>;
        delete: (id: number) => Promise<void>;
      };
      cafeOrder: {
        addToUnit: (unitId: number, cafeItemId: number, qty: number) => Promise<void>;
        listForUnit: (unitId: number) => Promise<any[]>;
        removeItem: (id: number) => Promise<void>;
        changeQty: (id: number, delta: number) => Promise<void>;
      };
      customers: {
        list: () => Promise<any[]>;
        create: (data: { name: string; phone?: string; initialDebt?: number }) => Promise<number>;
        history: (customerId: number) => Promise<any[]>;
        overdue: (days: number) => Promise<any[]>;
        delete: (id: number) => Promise<void>;
      };
      ledger: {
        addPayment: (customerId: number, amount: number, note?: string) => Promise<void>;
        addAdvance: (customerId: number, amount: number, note?: string) => Promise<void>;
      };
      employees: { list: () => Promise<any[]>; create: (name: string) => Promise<number>; delete: (id: number) => Promise<void> };
      shifts: {
        checkIn: (employeeId: number) => Promise<number>;
        checkOut: (shiftId: number) => Promise<void>;
        active: () => Promise<any[]>;
        report: (from: string, to: string) => Promise<any[]>;
      };
      checkout: {
        run: (input: {
          unitId?: number;
          standaloneCafe?: { cafeItemId: number; qty: number }[];
          paymentMethod: 'cash' | 'card' | 'credit' | 'cardTransfer';
          customerId?: number;
          employeeId?: number;
          shiftId?: number;
          manualAmount?: number;
          confirmedUnitAmount?: number;
          confirmedExactUnitAmount?: number;
          confirmedDurationMinutes?: number;
          adjustAmount?: number;
          adjustNote?: string;
          note?: string;
        }) => Promise<any>;
        runSplit: (input: {
          unitId: number;
          employeeId?: number;
          shiftId?: number;
          parts: {
            paymentMethod: 'cash' | 'card' | 'credit' | 'cardTransfer';
            customerId?: number;
            unitAmount?: number;
            cafeShares?: { cafeItemId: number; amount: number }[];
            adjustAmount?: number;
            adjustNote?: string;
          }[];
        }) => Promise<{ transactionIds: number[]; totalAmount: number }>;
      };
      transactions: { list: (from: string, to: string) => Promise<any[]> };
      reports: {
        range: (from: string, to: string) => Promise<any>;
        exportPdf: () => Promise<string | null>;
        last7Days: () => Promise<{ date: string; revenue: number }[]>;
        tabVisits: (from: string, to: string) => Promise<any[]>;
      };
      stockItems: {
        list: () => Promise<any[]>;
        create: (data: any) => Promise<number>;
        update: (id: number, data: any) => Promise<void>;
        archive: (id: number) => Promise<void>;
      };
      expenses: {
        list: (from: string, to: string) => Promise<any[]>;
        create: (data: { category: string; amount: number; description?: string; employeeId?: number }) => Promise<number>;
      };
      settingsPin: {
        check: (pin: string) => Promise<boolean>;
        isSet: () => Promise<boolean>;
        set: (pin: string) => Promise<void>;
        clear: () => Promise<void>;
      };
      reportsPin: {
        check: (pin: string) => Promise<boolean>;
        isSet: () => Promise<boolean>;
        set: (pin: string) => Promise<void>;
        clear: () => Promise<void>;
      };
      tournaments: {
        list: () => Promise<any[]>;
        create: (title: string, type: string) => Promise<number>;
        addParticipant: (tournamentId: number, name: string) => Promise<void>;
        participants: (tournamentId: number) => Promise<any[]>;
        eliminate: (participantId: number) => Promise<void>;
        setStatus: (id: number, status: string, winner?: string) => Promise<void>;
      };
      backup: { runNow: (extraDrivePath?: string) => Promise<string | null>; pickFolder: () => Promise<string | null> };
      openTabs: {
        list: () => Promise<any[]>;
        create: (data: { title?: string; customerName?: string; phone?: string; guestCount?: number; note?: string }) => Promise<number>;
        update: (id: number, data: Partial<{ title: string; customerName: string; phone: string; guestCount: number; note: string }>) => Promise<void>;
        delete: (id: number) => Promise<void>;
        get: (id: number) => Promise<{ tab: any; items: any[]; totals: { cafeTotal: number; billiardTotal: number; psTotal: number; unitTotal: number; total: number } } | null>;
        checkout: (input: {
          tabId: number;
          paymentMethod: 'cash' | 'card' | 'credit' | 'cardTransfer';
          customerId?: number;
          employeeId?: number;
          shiftId?: number;
          adjustAmount?: number;
          adjustNote?: string;
          note?: string;
        }) => Promise<{ transactionIds: number[]; unitAmount: number; cafeAmount: number; totalAmount: number }>;
        checkoutSplit: (input: {
          tabId: number;
          employeeId?: number;
          shiftId?: number;
          parts: {
            paymentMethod: 'cash' | 'card' | 'credit' | 'cardTransfer';
            customerId?: number;
            sessionShares?: { sessionId: number; amount: number }[];
            cafeShares?: { cafeItemId: number; amount: number }[];
            adjustAmount?: number;
            adjustNote?: string;
          }[];
        }) => Promise<{ transactionIds: number[]; unitAmount: number; cafeAmount: number; totalAmount: number; tabClosed: boolean }>;
      };
      openTabCafe: {
        add: (tabId: number, cafeItemId: number, qty: number) => Promise<void>;
        listForTab: (tabId: number) => Promise<any[]>;
        changeQty: (id: number, delta: number) => Promise<void>;
        updatePrice: (id: number, unitPrice: number) => Promise<void>;
        remove: (id: number) => Promise<void>;
        transfer: (id: number, toTabId: number) => Promise<void>;
        adoptFromUnit: (tabId: number, unitId: number) => Promise<void>;
      };
      openTabSessions: {
        remove: (id: number) => Promise<void>;
        updateAmount: (id: number, amount: number) => Promise<void>;
        transfer: (id: number, toTabId: number) => Promise<void>;
      };
      openTabsWindow: {
        open: () => Promise<void>;
      };
    };
  }
}
