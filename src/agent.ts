/**
 * Device-side agent: keeps a long-poll open to the Mac dashboard.
 *
 * Each heartbeat POSTs this device's identity + dock state and the server holds
 * the response open until it has a command (or ~25 s passes). When the dashboard
 * queues an "unlock", the held response returns immediately and we fire the
 * unlock broadcast LOCALLY via the native module — never over adb.
 */
import {Cradle, DeviceInfo, DockEvent} from './cradle';
import {DASHBOARD_URL} from './config';

type AgentStatus = 'starting' | 'online' | 'offline';
type StatusCb = (s: AgentStatus, detail?: string) => void;

export function startAgent(onStatus: StatusCb): () => void {
  let stopped = false;
  let info: DeviceInfo | null = null;
  let docked = false;
  let unsubDock = () => {};

  async function loop() {
    try {
      info = await Cradle.getDeviceInfo();
      docked = info.docked;
    } catch (e) {
      onStatus('offline', 'no native module');
      return;
    }

    unsubDock = Cradle.onDock((e: DockEvent) => {
      docked = e.docked;
    });

    while (!stopped) {
      try {
        const res = await fetch(`${DASHBOARD_URL}/api/heartbeat`, {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({
            serial: info.serial,
            model: info.model,
            docked,
          }),
        });
        onStatus('online');
        const cmd = await res.json().catch(() => ({}));
        if (cmd && cmd.cmd === 'unlock') {
          const seconds = typeof cmd.seconds === 'number' ? cmd.seconds : 10;
          try {
            await Cradle.unlock(seconds);
          } catch (err: any) {
            // Report the failure on the next heartbeat body if needed; keep looping.
            onStatus('online', 'unlock failed: ' + (err?.message ?? err));
          }
        }
      } catch (e: any) {
        onStatus('offline', e?.message ?? String(e));
        await delay(2000);
      }
    }
  }

  loop();

  return () => {
    stopped = true;
    unsubDock();
  };
}

function delay(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}
