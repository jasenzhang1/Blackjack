import { createRoot } from 'react-dom/client';
import App from './App';
import { initCloud } from './state/cloud';
import { SettingsProvider } from './state/settings';
import './styles/app.css';

initCloud();

createRoot(document.getElementById('root')!).render(
  <SettingsProvider>
    <App />
  </SettingsProvider>,
);
