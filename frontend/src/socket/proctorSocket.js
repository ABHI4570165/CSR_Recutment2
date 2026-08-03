import { io } from "socket.io-client";
import { SIGNALING_URL, SOCKET_PATH } from "../webrtc/iceConfig";

// Create a proctoring signaling socket. `role` is "admin" | "student";
// `token` is the admin JWT or the opaque candidate token. The connection is NOT
// auto-shared — each hook owns its socket and disconnects on cleanup.
export function createProctorSocket(role, token) {
  return io(SIGNALING_URL || "/", {
    path: SOCKET_PATH,
    transports: ["websocket"],
    auth: { role, token },
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    timeout: 15000,
  });
}
