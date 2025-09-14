module.exports = {
    apps: [{
            name: "backup",
            script: "backup.js",
            interpreter: "node",
            cron_restart: "0 0 * * *", // todos os dias às 00:10
            autorestart: false,
        },
    ],

};