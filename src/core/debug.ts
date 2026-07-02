// SDK-internal debug gate (#23, Workstream E). Silent by default so v3 never spams the
// host app's console; `createTelemetry({ debug: true })` flips it on. Gates log AND
// warn/error — nothing prints unless debug is enabled.
let enabled = false;

export function setDebug(on: boolean): void {
  enabled = on;
}

export const debug = {
  log: (...args: any[]) => { if (enabled) console.log(...args); },
  warn: (...args: any[]) => { if (enabled) console.warn(...args); },
  error: (...args: any[]) => { if (enabled) console.error(...args); },
};
