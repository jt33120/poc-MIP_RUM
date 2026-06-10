// Entry du bundle replay séparé (dist/mip-rum-replay.js, IIFE global MIPRumReplay).
// N'embarque que rrweb.record : lazy-loadé par le cœur (replay.ts) quand le
// replay est activé — le bundle principal mip-rum.js reste ≤ 35 KB gzip.
export { record } from "rrweb";
