import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { ytAudioPlugin } from './mcp/ytAudio.ts';

export default defineConfig({
  plugins: [react(), ytAudioPlugin()],
  test: {
    // Strudel's pattern engine imports a package whose Node entry lacks the
    // export it needs; letting Vite bundle them picks the working one.
    server: { deps: { inline: [/@strudel\//, /@kabelsalat\//] } },
  },
});
