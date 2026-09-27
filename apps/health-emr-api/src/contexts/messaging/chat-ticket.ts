/**
 * Marks a token as good for the message socket and nothing else.
 *
 * Checked by the gateway, so an ordinary access token that leaked into browser
 * storage could not be used here either — the two are deliberately not
 * interchangeable in this direction.
 */
export const CHAT_TICKET_TYPE = 'chat-socket';

export interface ChatTicketClaims {
  sub: string;
  typ: typeof CHAT_TICKET_TYPE;
}
