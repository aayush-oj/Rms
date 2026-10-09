import path from 'path';
import { getEnv } from './env';

export function getUploadsRoot(): string {
  const configured = getEnv().UPLOADS_DIR;
  return path.isAbsolute(configured)
    ? configured
    : path.resolve(process.cwd(), configured);
}

export function getMenuUploadsDirectory(): string {
  return path.join(getUploadsRoot(), 'menu');
}
