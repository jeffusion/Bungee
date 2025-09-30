import './style.css';
import type { AppConfig } from '@jeffusion/bungee-shared';

const app = document.querySelector<HTMLDivElement>('#app')!;

app.innerHTML = `
  <div class="container">
    <h1>Bungee Dashboard</h1>
    <p>Welcome to Bungee reverse proxy dashboard</p>
    <div id="status">Loading...</div>
  </div>
`;

// Fetch proxy status
async function fetchStatus() {
  try {
    const response = await fetch('/api/status');
    const data = await response.json();
    const statusEl = document.querySelector('#status')!;
    statusEl.innerHTML = `<pre>${JSON.stringify(data, null, 2)}</pre>`;
  } catch (error) {
    console.error('Failed to fetch status:', error);
  }
}

fetchStatus();