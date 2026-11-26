module.exports = {
  apps: [{
    name: 'Devlog',
    script: '/usr/bin/sudo',
    args: ['-n', '/opt/devlog/start-pm2'],
    interpreter: 'none',
    cwd: '/opt/devlog',
    exec_mode: 'fork',
    instances: 1,
    kill_timeout: 25000,
    restart_delay: 5000,
    treekill: false,
  }],
};
