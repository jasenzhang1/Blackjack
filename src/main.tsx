import { createRoot } from 'react-dom/client';
import App from './App';
import { SettingsProvider } from './state/settings';
import './styles/app.css';

createRoot(document.getElementById('root')!).render(
  <SettingsProvider>
    <App />
  </SettingsProvider>,
);
