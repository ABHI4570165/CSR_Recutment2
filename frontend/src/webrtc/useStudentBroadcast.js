import { useEffect, useRef, useCallback } from "react";
import { createProctorSocket } from "../socket/proctorSocket";
import { rtcConfig, SIGNALING_URL } from "./iceConfig";

/*
 * Student side of live proctoring. Given the webcam MediaStream, it:
 *   - connects to the signaling server as "student"
 *   - when an admin asks to watch, creates a peer connection + offer to THAT admin
 *   - relays ICE, tears the peer down when the admin leaves
 * Media is peer-to-peer; nothing is recorded or sent to our server.
 *
 * Returns { sendUpdate } so the exam page can push live status
 * (violations / cameraOn / currentQuestion).
 */
export function useStudentBroadcast({ token, stream, enabled }) {
  const socketRef = useRef(null);
  const peersRef = useRef(new Map());   // adminSocketId -> RTCPeerConnection

  const applyQuality = (pc, quality) => {
    const sender = pc.getSenders().find((s) => s.track && s.track.kind === "video");
    if (!sender) return;
    const p = sender.getParameters();
    if (!p.encodings || !p.encodings.length) p.encodings = [{}];
    const high = quality === "high";
    p.encodings[0].maxBitrate = high ? 700_000 : 150_000;
    p.encodings[0].maxFramerate = high ? 24 : 15;
    p.encodings[0].scaleResolutionDownBy = high ? 1 : 2;
    sender.setParameters(p).catch(() => {});
  };

  const makePeer = useCallback((adminSocketId, quality) => {
    const socket = socketRef.current;
    if (!socket || !stream) return null;
    // Reuse an existing peer if the admin re-requests (e.g. expand).
    let pc = peersRef.current.get(adminSocketId);
    if (pc) { applyQuality(pc, quality); return pc; }

    pc = new RTCPeerConnection(rtcConfig);
    peersRef.current.set(adminSocketId, pc);
    stream.getTracks().forEach((t) => pc.addTrack(t, stream));
    applyQuality(pc, quality);

    pc.onicecandidate = (e) => {
      if (e.candidate) socket.emit("webrtc:ice", { to: adminSocketId, candidate: e.candidate });
    };
    pc.onconnectionstatechange = () => {
      if (["failed", "closed", "disconnected"].includes(pc.connectionState)) {
        closePeer(adminSocketId);
      }
    };

    pc.createOffer()
      .then((offer) => pc.setLocalDescription(offer))
      .then(() => socket.emit("webrtc:offer", { to: adminSocketId, sdp: pc.localDescription }))
      .catch(() => closePeer(adminSocketId));
    return pc;
  }, [stream]);

  const closePeer = (adminSocketId) => {
    const pc = peersRef.current.get(adminSocketId);
    if (pc) { try { pc.close(); } catch { /* noop */ } peersRef.current.delete(adminSocketId); }
  };

  useEffect(() => {
    // HARD SAFETY GUARD: do absolutely nothing unless a signaling server is
    // explicitly configured (VITE_SIGNALING_URL). On the live exam site this is
    // unset, so no socket is ever opened — zero effect on students taking tests.
    if (!enabled || !token || !stream || !SIGNALING_URL) return;
    const socket = createProctorSocket("student", token);
    socketRef.current = socket;

    socket.on("student:watch-request", ({ adminSocketId, quality }) => makePeer(adminSocketId, quality));
    socket.on("student:watch-stop", ({ adminSocketId }) => closePeer(adminSocketId));
    socket.on("webrtc:answer", async ({ from, sdp }) => {
      const pc = peersRef.current.get(from);
      if (pc) { try { await pc.setRemoteDescription(new RTCSessionDescription(sdp)); } catch { /* noop */ } }
    });
    socket.on("webrtc:ice", async ({ from, candidate }) => {
      const pc = peersRef.current.get(from);
      if (pc && candidate) { try { await pc.addIceCandidate(new RTCIceCandidate(candidate)); } catch { /* noop */ } }
    });

    return () => {
      for (const id of [...peersRef.current.keys()]) closePeer(id);
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
    };
  }, [enabled, token, stream, makePeer]);

  const sendUpdate = useCallback((patch) => {
    if (socketRef.current && socketRef.current.connected) socketRef.current.emit("student:update", patch);
  }, []);

  return { sendUpdate };
}
