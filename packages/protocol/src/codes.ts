/**
 * Room join codes: short, upper case, and free of look-alikes (no 0/O, 1/I/L),
 * so one can be read out loud or typed from a screenshot.
 */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_LENGTH = 5;

/** A fresh random code (31^5, about 28 million of them). */
export function newRoomCode(random: () => number = Math.random): string {
  let code = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    code += ROOM_CODE_ALPHABET[Math.floor(random() * ROOM_CODE_ALPHABET.length)];
  }
  return code;
}

/** A typed or pasted code as the room is addressed: upper case, letters and digits only. */
export function normalizeRoomCode(typed: string): string {
  return typed.toUpperCase().replace(/[^A-Z0-9]/g, '');
}
