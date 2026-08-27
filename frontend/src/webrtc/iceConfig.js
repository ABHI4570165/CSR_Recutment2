// ICE servers for WebRTC. Google STUN is free and enough for most home networks.
// TURN is REQUIRED for mobile / college / office networks (CGNAT + UDP blocks) —
// on mobile data especially, video only connects through a TURN relay.
// Set VITE_TURN_URLS (comma-separated, so we can include UDP + TCP:443 + TLS:443
// for maximum reachability) plus VITE_TURN_USER / VITE_TURN_PASS to enable it.
const turnUrls = (import.meta.env.VITE_TURN_URLS || import.meta.env.VITE_TURN_URL || "")
  .split(",").map((s) => s.trim()).filter(Boolean);
const turnUser = import.meta.env.VITE_TURN_USER;
const turnPass = import.meta.env.VITE_TURN_PASS;

export const ICE_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  ...(turnUrls.length && turnUser && turnPass
    ? [{ urls: turnUrls, username: turnUser, credential: turnPass }]
    : []),
];

// Signaling server URL — ONE fixed instance (not the load-balanced REST set), so
// student and admin sockets share the same presence. Falls back to same-origin.
export const SIGNALING_URL = import.meta.env.VITE_SIGNALING_URL || undefined;
export const SOCKET_PATH = "/proctor-socket";

export const rtcConfig = { iceServers: ICE_SERVERS, iceCandidatePoolSize: 2 };
