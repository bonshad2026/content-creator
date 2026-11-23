import {afterEach,vi} from 'vitest';
import {cleanup} from '@testing-library/react';
afterEach(()=>{cleanup();vi.useRealTimers();});
Object.defineProperty(window,'matchMedia',{value:()=>({matches:false,addEventListener(){},removeEventListener(){}}),writable:true});
Object.defineProperty(URL,'createObjectURL',{value:vi.fn(()=>`blob:fixture-${Math.random()}`),writable:true});
Object.defineProperty(URL,'revokeObjectURL',{value:vi.fn(),writable:true});
HTMLElement.prototype.scrollTo=vi.fn();
HTMLMediaElement.prototype.play=vi.fn(async()=>{});
HTMLMediaElement.prototype.pause=vi.fn();
