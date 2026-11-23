import {defineConfig} from 'vitest/config';
export default defineConfig({test:{environment:'jsdom',include:['web/**/*.test.ts','web/**/*.test.tsx','web/**/*.test.js'],setupFiles:['./web/test-setup.ts'],restoreMocks:true}});
