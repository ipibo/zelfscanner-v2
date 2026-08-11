/**
 * Dashboard endpoint the device app reports to.
 * Set DASHBOARD_HOST to the Mac running dashboard/server.js (same WiFi).
 */
export const DASHBOARD_HOST = '192.168.1.7';
export const DASHBOARD_PORT = 8765;
export const DASHBOARD_URL = `http://${DASHBOARD_HOST}:${DASHBOARD_PORT}`;
