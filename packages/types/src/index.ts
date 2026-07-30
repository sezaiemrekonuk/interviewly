export type { ErrorCode, ErrorKind } from '../../../backend/src/lib/error-codes';
export { ERROR_CODES } from '../../../backend/src/lib/error-codes';

export type AvatarState = 'idle' | 'listening' | 'thinking' | 'speaking' | 'acknowledging';
export type MascotPose = 'wave' | 'point' | 'think' | 'cheer' | 'shrug';   // ui §4.2.1

// Shared API response envelope — used by both backend and frontend
export interface ApiError { error: { code: import('../../../backend/src/lib/error-codes').ErrorCode; message?: string } }
