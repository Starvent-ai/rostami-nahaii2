import { ChooseTabFlow } from './ChooseTabFlow';

export function LinkToTabModal({ unit, onClose }: { unit: { id: number; name: string }; onClose: () => void }) {
  async function handleResolved(tabId: number) {
    await window.api.units.linkToTab(unit.id, tabId);
    onClose();
  }

  return <ChooseTabFlow headerTitle={`افزودن «${unit.name}» به حساب باز`} onResolved={handleResolved} onCancel={onClose} />;
}
