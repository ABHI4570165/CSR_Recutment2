// ICE servers for WebRTC. Google STUN is free and enough for most home networks.
// TURN (Coturn) is OPTIONAL but needed for restrictive college/office networks —
// set VITE_TURN_URL / VITE_TURN_USER / VITE_TURN_PASS to enable it.
const turnUrl  = import.meta.env.VITE_TURN_URL;
const turnUser = import.meta.env.VITE_TURN_USER;
const turnPass = import.meta.env.VITE_TURN_PASS;

export const ICE_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  ...(turnUrl && turnUser && turnPass
    ? [{ urls: turnUrl, username: turnUser, credential: turnPass }]
    : []),
];

// Signaling server URL — ONE fixed instance (not the load-balanced REST set), so
// student and admin sockets share the same presence. Falls back to same-origin.
export const SIGNALING_URL = import.meta.env.VITE_SIGNALING_URL || undefined;
export const SOCKET_PATH = "/proctor-socket";

export const rtcConfig = { iceServers: ICE_SERVERS, iceCandidatePoolSize: 2 };
