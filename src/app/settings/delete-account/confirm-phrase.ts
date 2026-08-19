/** The exact phrase the type-to-confirm gate requires. Its own module (not
 *  in actions.ts) because 'use server' files may only export async functions;
 *  the form imports it for the input gate, the action for the server check. */
export const DELETE_CONFIRM_PHRASE = 'DELETE'
