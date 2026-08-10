/*
 * Live Proctoring — WebRTC signaling server (Socket.IO).
 *
 * The server ONLY does signaling + auth. Video is peer-to-peer (browser→browser)
 * and never touches this server. Because the frontend load-balances REST across
 * 6 instances, sockets must all connect to ONE fixed signaling URL
 * (VITE_SIGNALING_URL) so student and admin share the same in-memory presence —
 * no Redis needed for a single dedicated instance.
 *
 * Roles:
 *   admin   — authenticated with the admin JWT (ADMIN_JWT_SECRET). Watches streams.
 *   student — authenticated with their opaque candidate token (must be in-progress).
 *             Streams their own webcam; never receives another student's stream.
 */
const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");
const Candidate = require("../models/Candidate");
const Assessment = require("../models/Assessment");

// In-memory presence for this instance: candidateId -> live student info.
const students = new Map();      // candidateId -> { socketId, name, college, testName, assessmentId, cameraOn, violations, currentQuestion, startedAt }
const adminSockets = new Set();  // admin socket ids

function studentPublic(s) {
  return {
    candidateId: s.candidateId, name: s.name, college: s.college, testName: s.testName,
    socketId: s.socketId, cameraOn: s.cameraOn, violations: s.violations,
    currentQuestion: s.currentQuestion, startedAt: s.startedAt, status: "in-progress",
  };
}

function attachSignaling(httpServer, allowedOrigins) {
  const originCheck = (origin, cb) => {
    if (!origin) return cb(null, true);
    // Always allow localhost / 127.0.0.1 on any port (local dev, Vite any port).
    if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)) return cb(null, true);
    if (!allowedOrigins || !allowedOrigins.length) return cb(null, true);
    if (allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error("Origin not allowed"));
  };
  const io = new Server(httpServer, {
    path: "/proctor-socket",
    cors: { origin: originCheck, credentials: true },
    maxHttpBufferSize: 1e6,
  });

  // ── Auth handshake ─────────────────────────────────────────────────────────
  io.use(async (socket, next) => {
    try {
      const { role, token } = socket.handshake.auth || {};
      if (role === "admin") {
        if (!token) return next(new Error("No admin token."));
        jwt.verify(token, process.env.ADMIN_JWT_SECRET);   // throws if invalid/expired
        socket.data = { role: "admin" };
        return next();
      }
      if (role === "student") {
        if (!token) return next(new Error("No candidate token."));
        const c = await Candidate.findOne({ token }).select("name college assessmentId status").lean();
        if (!c) return next(new Error("Invalid candidate token."));
        if (c.status !== "in-progress" && c.status !== "started") return next(new Error("Assessment not active."));
        const a = await Assessment.findById(c.assessmentId).select("name").lean();
        socket.data = {
          role: "student", candidateId: String(c._id), name: c.name, college: c.college,
          assessmentId: String(c.assessmentId), testName: a ? a.name : "Assessment",
        };
        return next();
      }
      return next(new Error("Unknown role."));
    } catch (e) {
      return next(new Error("Unauthorized: " + (e.message || "auth failed")));
    }
  });

  io.on("connection", (socket) => {
    const d = socket.data;

    if (d.role === "admin") {
      adminSockets.add(socket.id);
      // Send the current roster of online students immediately.
      socket.emit("proctor:roster", [...students.values()].map(studentPublic));

      // Admin wants to watch a student → ask that student to start a stream to this admin.
      socket.on("admin:watch", ({ candidateId, quality } = {}) => {
        const s = students.get(candidateId);
        if (!s) return socket.emit("proctor:error", { candidateId, message: "Student offline." });
        io.to(s.socketId).emit("student:watch-request", { adminSocketId: socket.id, quality: quality || "low" });
      });
      // Admin stopped watching → tell the student to tear down that peer.
      socket.on("admin:unwatch", ({ candidateId } = {}) => {
        const s = students.get(candidateId);
        if (s) io.to(s.socketId).emit("student:watch-stop", { adminSocketId: socket.id });
      });

      // WebRTC relay (admin → student).
      socket.on("webrtc:answer", ({ to, sdp }) => io.to(to).emit("webrtc:answer", { from: socket.id, sdp }));
      socket.on("webrtc:ice",    ({ to, candidate }) => io.to(to).emit("webrtc:ice", { from: socket.id, candidate }));

      socket.on("disconnect", () => {
        adminSockets.delete(socket.id);
        // Tell every student this admin stopped watching so they free peers.
        for (const s of students.values()) io.to(s.socketId).emit("student:watch-stop", { adminSocketId: socket.id });
      });
      return;
    }

    // ── Student ────────────────────────────────────────────────────────────────
    const rec = {
      socketId: socket.id, candidateId: d.candidateId, name: d.name, college: d.college,
      testName: d.testName, assessmentId: d.assessmentId, cameraOn: true, violations: 0,
      currentQuestion: 0, startedAt: Date.now(),
    };
    students.set(d.candidateId, rec);
    broadcastToAdmins(io, "proctor:student-online", studentPublic(rec));

    // Live status pushed by the exam page (violations, camera, progress).
    socket.on("student:update", (patch = {}) => {
      if (typeof patch.cameraOn === "boolean") rec.cameraOn = patch.cameraOn;
      if (Number.isFinite(patch.violations)) rec.violations = patch.violations;
      if (Number.isFinite(patch.currentQuestion)) rec.currentQuestion = patch.currentQuestion;
      broadcastToAdmins(io, "proctor:student-update", studentPublic(rec));
    });

    // WebRTC relay (student → admin).
    socket.on("webrtc:offer", ({ to, sdp }) => io.to(to).emit("webrtc:offer", { from: socket.id, candidateId: d.candidateId, sdp }));
    socket.on("webrtc:ice",   ({ to, candidate }) => io.to(to).emit("webrtc:ice", { from: socket.id, candidate }));

    socket.on("disconnect", () => {
      students.delete(d.candidateId);
      broadcastToAdmins(io, "proctor:student-offline", { candidateId: d.candidateId });
    });
  });

  console.log("🎥  Live proctoring signaling attached at /proctor-socket");
  return io;
}

function broadcastToAdmins(io, event, payload) {
  for (const id of adminSockets) io.to(id).emit(event, payload);
}

module.exports = { attachSignaling };
