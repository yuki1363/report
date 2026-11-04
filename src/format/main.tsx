import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../client/styles.css';
import { FormatApp } from './FormatApp.tsx';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <FormatApp />
  </StrictMode>,
);
