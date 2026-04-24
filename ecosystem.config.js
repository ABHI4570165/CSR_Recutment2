// PM2 cluster config
module.exports = {
  apps: [{
    name: "mha-quiz-api",
    script: "./backend/server.js",
    instances: "max",       // Use all CPU cores
    exec_mode: "cluster",
    watch: false,
    max_memory_restart: "800M",
    env: {
      NODE_ENV: "production",
      PORT: 5000,
    },
    error_file: "./logs/err.log",
    out_file:   "./logs/out.log",
    merge_logs: true,
    log_date_format: "YYYY-MM-DD HH:mm:ss",
    autorestart: true,
    max_restarts: 10,
    min_uptime: 5000,
  }],
};
