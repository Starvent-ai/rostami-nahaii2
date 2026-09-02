import { contextBridge, ipcRenderer } from 'electron';

const invoke = (channel: string) => (...args: unknown[]) => ipcRenderer.invoke(channel, ...args);

const api = {
  onEvent: (cb: (e: { domains: string[]; payload?: unknown }) => void) => {
    const handler = (_e: unknown, data: any) => cb(data);
    ipcRenderer.on('club:event', handler);
    return () => ipcRenderer.removeListener('club:event', handler);
  },

  recovery: {
    getOrphans: invoke('recovery:getOrphans'),
  },
  settings: {
    getAll: invoke('settings:getAll'),
    set: invoke('settings:set'),
  },
  unitTypes: {
    list: invoke('unitTypes:list'),
    create: invoke('unitTypes:create'),
    update: invoke('unitTypes:update'),
    archive: invoke('unitTypes:archive'),
  },
  units: {
    list: invoke('units:list'),
    create: invoke('units:create'),
    update: invoke('units:update'),
    archive: invoke('units:archive'),
    start: invoke('units:start'),
    reserve: invoke('units:reserve'),
    cancelReserve: invoke('units:cancelReserve'),
    calcAmount: invoke('units:calcAmount'),
    endToTab: invoke('units:endToTab'),
    linkToTab: invoke('units:linkToTab'),
  },
  cafeItems: {
    list: invoke('cafeItems:list'),
    create: invoke('cafeItems:create'),
    update: invoke('cafeItems:update'),
    archive: invoke('cafeItems:archive'),
    restock: invoke('cafeItems:restock'),
  },
  cafeCategories: {
    list: invoke('cafeCategories:list'),
    create: invoke('cafeCategories:create'),
    update: invoke('cafeCategories:update'),
    delete: invoke('cafeCategories:delete'),
  },
  cafeOrder: {
    addToUnit: invoke('cafeOrder:addToUnit'),
    listForUnit: invoke('cafeOrder:listForUnit'),
    removeItem: invoke('cafeOrder:removeItem'),
    changeQty: invoke('cafeOrder:changeQty'),
  },
  customers: {
    list: invoke('customers:list'),
    create: invoke('customers:create'),
    history: invoke('customers:history'),
    overdue: invoke('customers:overdue'),
    delete: invoke('customers:delete'),
  },
  ledger: {
    addPayment: invoke('ledger:addPayment'),
    addAdvance: invoke('ledger:addAdvance'),
  },
  employees: {
    list: invoke('employees:list'),
    create: invoke('employees:create'),
    delete: invoke('employees:delete'),
  },
  shifts: {
    checkIn: invoke('shifts:checkIn'),
    checkOut: invoke('shifts:checkOut'),
    active: invoke('shifts:active'),
    report: invoke('shifts:report'),
  },
  checkout: {
    run: invoke('checkout:run'),
    runSplit: invoke('checkout:runSplit'),
  },
  transactions: {
    list: invoke('transactions:list'),
  },
  reports: {
    range: invoke('reports:range'),
    exportPdf: invoke('reports:exportPdf'),
    last7Days: invoke('reports:last7Days'),
    tabVisits: invoke('reports:tabVisits'),
  },
  tournaments: {
    list: invoke('tournaments:list'),
    create: invoke('tournaments:create'),
    addParticipant: invoke('tournaments:addParticipant'),
    participants: invoke('tournaments:participants'),
    eliminate: invoke('tournaments:eliminate'),
    setStatus: invoke('tournaments:setStatus'),
  },
  stockItems: {
    list: invoke('stockItems:list'),
    create: invoke('stockItems:create'),
    update: invoke('stockItems:update'),
    archive: invoke('stockItems:archive'),
  },
  expenses: {
    list: invoke('expenses:list'),
    create: invoke('expenses:create'),
  },
  settingsPin: {
    check: invoke('settingsPin:check'),
    isSet: invoke('settingsPin:isSet'),
    set: invoke('settingsPin:set'),
    clear: invoke('settingsPin:clear'),
  },
  reportsPin: {
    check: invoke('reportsPin:check'),
    isSet: invoke('reportsPin:isSet'),
    set: invoke('reportsPin:set'),
    clear: invoke('reportsPin:clear'),
  },
  backup: {
    runNow: invoke('backup:runNow'),
    pickFolder: invoke('backup:pickFolder'),
  },
  openTabs: {
    list: invoke('openTabs:list'),
    create: invoke('openTabs:create'),
    update: invoke('openTabs:update'),
    delete: invoke('openTabs:delete'),
    get: invoke('openTabs:get'),
    checkout: invoke('openTabs:checkout'),
    checkoutSplit: invoke('openTabs:checkoutSplit'),
  },
  openTabCafe: {
    add: invoke('openTabCafe:add'),
    listForTab: invoke('openTabCafe:listForTab'),
    changeQty: invoke('openTabCafe:changeQty'),
    updatePrice: invoke('openTabCafe:updatePrice'),
    remove: invoke('openTabCafe:remove'),
    transfer: invoke('openTabCafe:transfer'),
    adoptFromUnit: invoke('openTabCafe:adoptFromUnit'),
  },
  openTabSessions: {
    remove: invoke('openTabSessions:remove'),
    updateAmount: invoke('openTabSessions:updateAmount'),
    transfer: invoke('openTabSessions:transfer'),
  },
  openTabsWindow: {
    open: invoke('openTabsWindow:open'),
  },
};

contextBridge.exposeInMainWorld('api', api);

export type ClubApi = typeof api;
