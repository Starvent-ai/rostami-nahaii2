import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './design/global.css';
import App from './App';
import { OpenTabsWindowApp } from './modules/opentabs/OpenTabsWindowApp';

// The "حساب‌های باز" feature opens in its own separate Electron window
// (electron/main.ts createOpenTabsWindow) rather than as an overlay in the
// main window, so staff can keep it open on a second screen. That window
// loads this exact same bundle with a #/opentabs-window hash to pick which
// top-level app to render.
const isOpenTabsWindow = window.location.hash === '#/opentabs-window';

createRoot(document.getElementById('root')!).render(
  <StrictMode>{isOpenTabsWindow ? <OpenTabsWindowApp /> : <App />}</StrictMode>
);
