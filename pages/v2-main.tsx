import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import V2App from '../app/v2/V2App';

createRoot(document.getElementById('root')!).render(<StrictMode><V2App /></StrictMode>);
