// services/moon/frontend/src/App.jsx

import { useState } from 'react';
import './App.css';

/**
 * 🌕 Noona-Moon Setup UI
 * Displays a simple counter button to confirm React + Tailwind are working.
 *
 * @component
 * @returns {JSX.Element} The rendered app UI
 */
export default function App() {
  const [count, setCount] = useState(0);

  return (
    <div className="h-screen bg-gray-900 text-white flex flex-col items-center justify-center">
      <h1 className="text-4xl mb-6">🌕 Hello from Noona-Moon</h1>
      <button
        onClick={() => setCount((prev) => prev + 1)}
        className="px-6 py-3 bg-indigo-600 hover:bg-indigo-700 rounded-lg text-lg transition"
      >
        You clicked me {count} time{count !== 1 ? 's' : ''}
      </button>
    </div>
  );
}
