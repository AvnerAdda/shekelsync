/// <reference types="vite/client" />
import '../../app/types/global.d.ts';

declare module '*.svg?url' {
  const src: string;
  export default src;
}
