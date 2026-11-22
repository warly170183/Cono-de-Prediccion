import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import './lib/authFetch.ts';
import { AuthProvider } from './lib/AuthContext.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <AuthProvider>
      <App />
    </AuthProvider>
  </ErrorBoundary>,
);
