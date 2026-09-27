'use client';

import * as React from 'react';
import { io, type Socket } from 'socket.io-client';
import { api } from './api';

/**
 * Live messages, without the access token ever reaching this file.
 *
 * Everything else in the browser talks to the BFF, which attaches the token
 * server-side — that is what keeps an XSS bug from becoming a breach. A socket
 * handshake cannot do that: it opens a direct connection to the API and cannot
 * carry the session cookie across origins.
 *
 * So the page asks the BFF for a ticket instead. It lasts a minute, it names
 * only who is connecting, and it opens nothing but that person's own
 * conversations — every authorisation decision is still made against the
 * membership table on the server.
 *
 * Without this the chat only updated when a component refetched, which meant a
 * reply from the other person sat unseen until somebody reloaded the page.
 */
const API_ORIGIN = process.env.NEXT_PUBLIC_API_ORIGIN ?? 'http://localhost:4000';

export interface IncomingMessage {
  threadId: string;
  messageId: string;
  author: string;
  authorRole: string;
  content: string;
  sentAt: string;
}

export function useChatSocket(onMessage: (message: IncomingMessage) => void) {
  const [connected, setConnected] = React.useState(false);
  const socketRef = React.useRef<Socket | null>(null);

  // Held in a ref so reconnecting does not depend on the callback's identity —
  // a caller that rebuilds its handler each render would otherwise tear the
  // socket down and open a new one on every keystroke.
  const handler = React.useRef(onMessage);
  React.useEffect(() => {
    handler.current = onMessage;
  });

  React.useEffect(() => {
    let live = true;
    let socket: Socket | null = null;

    (async () => {
      try {
        const { ticket } = await api<{ ticket: string }>('v1/chat/ticket', { method: 'POST' });
        if (!live) return;

        socket = io(API_ORIGIN, {
          path: '/v1/chat/ws',
          auth: { token: ticket },
          transports: ['websocket'],
          withCredentials: true,
        });

        socket.on('connect', () => live && setConnected(true));
        socket.on('disconnect', () => live && setConnected(false));
        socket.on('chat.message', (message: IncomingMessage) => handler.current(message));

        socketRef.current = socket;
      } catch {
        // No socket is a degraded experience, not a broken one: the panels
        // still load their messages when opened. Staying quiet is better than
        // an error nobody can act on.
      }
    })();

    return () => {
      live = false;
      socket?.disconnect();
      socketRef.current = null;
    };
  }, []);

  /** Joins a conversation that did not exist when the socket connected. */
  const watch = React.useCallback((threadId: string) => {
    socketRef.current?.emit('thread.watch', { threadId });
  }, []);

  return { connected, watch };
}
