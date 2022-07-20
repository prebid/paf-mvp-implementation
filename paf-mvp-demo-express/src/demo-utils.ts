import { join } from 'path';
import fs, { readFileSync } from 'fs';
import { AxiosRequestConfig } from 'axios';
import https from 'https';

const relative = (path: string) => join(__dirname, path);
/**
 * **When running locally**, use generated certificate and run HTTPs server
 * (on prod a reverse proxy handles it)
 * See README.md for instruction on how to generate it
 */
export const keyPath = relative('../paf.key');
export const crtPath = relative('../paf.crt');

export const isRunningOnDeveloperPC = fs.existsSync(keyPath) && fs.existsSync(crtPath);

export let sslOptions: { key: Buffer; cert: Buffer; passphrase: string };

export const s2sOptions: AxiosRequestConfig = {};

if (isRunningOnDeveloperPC) {
  sslOptions = {
    key: readFileSync(keyPath),
    cert: readFileSync(crtPath),
    passphrase: 'prebid',
  };
  // If running locally, then the certificate must be trusted for S2S calls
  s2sOptions.httpsAgent = new https.Agent({
    rejectUnauthorized: false,
    ...sslOptions,
  });
}
