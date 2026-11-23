import {useEffect,useRef,useState,useSyncExternalStore} from 'react';
import {draftStore} from './draft';
export const useDraft=()=>useSyncExternalStore(draftStore.subscribe,draftStore.getSnapshot);
export function useObjectURL(file?:Blob){const [url,setURL]=useState('');useEffect(()=>{if(!file){setURL('');return;}const next=URL.createObjectURL(file);setURL(next);return()=>URL.revokeObjectURL(next);},[file]);return url;}
export function useViewport(){useEffect(()=>{const update=()=>{document.documentElement.style.setProperty('--viewport-height',`${window.visualViewport?.height||window.innerHeight}px`);document.documentElement.style.setProperty('--viewport-top',`${window.visualViewport?.offsetTop||0}px`);};update();window.visualViewport?.addEventListener('resize',update);window.visualViewport?.addEventListener('scroll',update);window.addEventListener('resize',update);return()=>{window.visualViewport?.removeEventListener('resize',update);window.visualViewport?.removeEventListener('scroll',update);window.removeEventListener('resize',update);};},[]);}
export function useLatest<T>(value:T){const ref=useRef(value);ref.current=value;return ref;}
